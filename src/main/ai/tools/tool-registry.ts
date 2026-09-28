import type { ChatProviderTool, ChatProviderToolResultPart } from '@mico/ai-providers'
import type { ToolOutputDeltaData } from '@shared/ipc/schemas/chat'

import { createBashTool } from './bash-tool'
import { createEditTool } from './edit-tool'
import { createReadTool } from './read-tool'
import {
  registerTool,
  type RegisteredAgentTool,
  type ToolInput,
  type ToolOutputDelta
} from './tool-contract'
import { createWriteTool } from './write-tool'

type ToolCall = { toolCallId: string; toolName: string; input: ToolInput }

// A UTF-16 slice may encode to up to four bytes per code unit. Keep each IPC
// fragment safely below the shared 64 KiB payload ceiling while preserving all
// output from tools whose previews are larger than one renderer update.
const MAX_OUTPUT_DELTA_CHARS = 16 * 1024

class ToolRegistry {
  readonly #tools: Map<string, RegisteredAgentTool>
  readonly #cwd: string

  private constructor(cwd: string, tools: RegisteredAgentTool[]) {
    this.#cwd = cwd
    this.#tools = new Map(tools.map((tool) => [tool.definition.name, tool]))
  }

  static forWorkspace(cwd: string): ToolRegistry {
    return new ToolRegistry(cwd, [
      registerTool(createReadTool()),
      registerTool(createEditTool()),
      registerTool(createWriteTool()),
      registerTool(createBashTool())
    ])
  }

  get definitions(): readonly ChatProviderTool[] {
    return [...this.#tools.values()].map((tool) => tool.definition)
  }

  async execute(
    call: ToolCall,
    signal: AbortSignal,
    onOutputDelta?: (delta: ToolOutputDeltaData) => void
  ): Promise<ChatProviderToolResultPart> {
    const tool = this.#tools.get(call.toolName)
    if (!tool) return this.errorResult(call, `Tool "${call.toolName}" is unavailable.`)
    try {
      const result = await tool.execute(call.input, {
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
      return {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: result.output,
        isError: false,
        type: 'tool-result'
      }
    } catch (error) {
      return this.errorResult(
        call,
        error instanceof Error ? error.message : 'Tool execution failed.'
      )
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
  ): Promise<ChatProviderToolResultPart[]> {
    const results: ChatProviderToolResultPart[] = []
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

export { ToolRegistry, type ToolCall }
