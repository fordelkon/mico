import type { ChatProviderTool, ChatProviderToolResultPart } from '@mico/ai-providers'
import type { ToolOutputDeltaData } from '@shared/ipc/schemas/chat'

import type { SkillSnapshot } from '../skills'
import { createBashTool } from './bash-tool'
import { createEditTool } from './edit-tool'
import { createReadTool } from './read-tool'
import { createGlobTool, createGrepTool } from './search-tool'
import { createLoadSkillTool, createReadSkillResourceTool } from './skill-tools'
import {
  type RegisteredAgentTool,
  registerTool,
  type ToolExecutionTrace,
  type ToolInput,
  type ToolOutputDelta
} from './tool-contract'
import { runPostToolUse, runPreToolUse, type ToolHooks } from './tool-hooks'
import { authorizeTool, type ToolPermissionOptions } from './tool-permissions'
import { createWriteTool } from './write-tool'

type ToolCall = { toolCallId: string; toolName: string; input: ToolInput }
type ToolRegistryOptions = ToolPermissionOptions & {
  hooks?: ToolHooks
  skills?: SkillSnapshot
  authorizedSkillIds?: readonly string[]
}
type ToolExecution = { result: ChatProviderToolResultPart; trace: ToolExecutionTrace }

// A UTF-16 slice may encode to up to four bytes per code unit. Keep each IPC
// fragment safely below the shared 64 KiB payload ceiling while preserving all
// output from tools whose previews are larger than one renderer update.
const MAX_OUTPUT_DELTA_CHARS = 16 * 1024

class ToolRegistry {
  readonly #tools: Map<string, RegisteredAgentTool>
  readonly #cwd: string
  readonly #options: ToolRegistryOptions

  private constructor(cwd: string, tools: RegisteredAgentTool[], options: ToolRegistryOptions) {
    this.#cwd = cwd
    this.#tools = new Map(tools.map((tool) => [tool.definition.name, tool]))
    this.#options = options
  }

  static forWorkspace(cwd: string, options: ToolRegistryOptions = {}): ToolRegistry {
    return new ToolRegistry(
      cwd,
      [
        registerTool(createReadTool()),
        registerTool(createGlobTool()),
        registerTool(createGrepTool()),
        registerTool(createEditTool()),
        registerTool(createWriteTool()),
        registerTool(createBashTool()),
        ...(options.skills
          ? [
              registerTool(createLoadSkillTool(options.skills, options.authorizedSkillIds)),
              registerTool(createReadSkillResourceTool(options.skills, options.authorizedSkillIds))
            ]
          : [])
      ],
      options
    )
  }

  get definitions(): readonly ChatProviderTool[] {
    return [...this.#tools.values()].map((tool) => tool.definition)
  }

  async execute(
    call: ToolCall,
    signal: AbortSignal,
    onOutputDelta?: (delta: ToolOutputDeltaData) => void
  ): Promise<ToolExecution> {
    const startedAt = Date.now()
    const snapshot = { ...call, input: freezeInput(call.input) }
    const result = await this.executeCall(snapshot, signal, onOutputDelta)
    return {
      result,
      trace: {
        toolCallId: snapshot.toolCallId,
        toolName: snapshot.toolName,
        input: snapshot.input,
        output: result.output,
        isError: result.isError,
        startedAt,
        finishedAt: Date.now()
      }
    }
  }

  private async executeCall(
    call: ToolCall,
    signal: AbortSignal,
    onOutputDelta?: (delta: ToolOutputDeltaData) => void
  ): Promise<ChatProviderToolResultPart> {
    signal.throwIfAborted()
    const tool = this.#tools.get(call.toolName)
    if (!tool) return this.errorResult(call, `Tool "${call.toolName}" is unavailable.`)
    // Neither hooks nor an approval host may change the operation after validation.
    const snapshot = call
    const hookContext = { ...snapshot, cwd: this.#cwd, signal }
    const hooks = this.#options.hooks ?? {}
    try {
      signal.throwIfAborted()
      const prepared = await tool.prepare(snapshot.input, {
        cwd: this.#cwd,
        signal,
        onOutputDelta: (delta: ToolOutputDelta) => {
          if (!delta.delta) return
          for (let offset = 0; offset < delta.delta.length; offset += MAX_OUTPUT_DELTA_CHARS)
            onOutputDelta?.({
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              stream: delta.stream,
              delta: delta.delta.slice(offset, offset + MAX_OUTPUT_DELTA_CHARS)
            })
        }
      })
      const askReason = await runPreToolUse(hooks, hookContext)
      await authorizeTool(snapshot, this.#cwd, signal, prepared.operation, this.#options, askReason)
      signal.throwIfAborted()
      const result = await prepared.execute()
      await runPostToolUse(hooks, { ...hookContext, output: result.output, isError: false })
      return {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: result.output,
        isError: false,
        type: 'tool-result'
      }
    } catch (error) {
      if (signal.aborted) throw error
      const output = error instanceof Error ? error.message : 'Tool execution failed.'
      await runPostToolUse(hooks, { ...hookContext, output, isError: true })
      return this.errorResult(call, output)
    }
  }

  /**
   * Executes calls in submission order. Consecutive concurrency-safe calls
   * merge into one parallel batch; a call classified unsafe (per its input,
   * fail-closed) breaks the run and executes alone, so the next call observes
   * its effects. Results always come back indexed by submission order.
   */
  async executeBatch(
    calls: readonly ToolCall[],
    signal: AbortSignal,
    onOutputDelta?: (delta: ToolOutputDeltaData) => void
  ): Promise<ToolExecution[]> {
    const results: ToolExecution[] = []
    for (const batch of partitionCalls(calls, (call) => this.isConcurrencySafe(call))) {
      if (batch.isConcurrencySafe) {
        signal.throwIfAborted()
        await Promise.all(
          batch.calls.map(async (call) => {
            results[call.index] = await this.execute(call.toolCall, signal, onOutputDelta)
          })
        )
      } else {
        for (const { index, toolCall } of batch.calls) {
          signal.throwIfAborted()
          results[index] = await this.execute(toolCall, signal, onOutputDelta)
        }
      }
    }
    return results
  }

  private isConcurrencySafe(call: ToolCall): boolean {
    return this.#tools.get(call.toolName)?.isConcurrencySafe(call.input) ?? false
  }

  private errorResult(call: ToolCall, output: string): ChatProviderToolResultPart {
    return {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output,
      isError: true,
      type: 'tool-result'
    }
  }
}

function freezeInput(input: ToolInput): ToolInput {
  // SAFETY: ToolInput is JSON protocol data; the reviver preserves its values
  // and freezes nested containers before exposing them to internal hooks.
  return JSON.parse(JSON.stringify(input), (_key, value) => Object.freeze(value)) as ToolInput
}

type PartitionedCall = { index: number; toolCall: ToolCall }
type Batch = { isConcurrencySafe: boolean; calls: PartitionedCall[] }

/** Greedy, order-preserving: consecutive safe calls merge; an unsafe call breaks the run. */
function partitionCalls(
  calls: readonly ToolCall[],
  isConcurrencySafe: (call: ToolCall) => boolean
): Batch[] {
  return calls.reduce((batches: Batch[], toolCall, index) => {
    const safe = isConcurrencySafe(toolCall)
    const call = { index, toolCall }
    const last = batches.at(-1)
    if (safe && last?.isConcurrencySafe) last.calls.push(call)
    else batches.push({ isConcurrencySafe: safe, calls: [call] })
    return batches
  }, [])
}

export { type ToolCall, type ToolExecution, ToolRegistry }
