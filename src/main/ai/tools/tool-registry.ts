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

  async executeBatch(
    calls: readonly ToolCall[],
    signal: AbortSignal,
    onOutputDelta?: (delta: ToolOutputDeltaData) => void
  ): Promise<ChatProviderToolResultPart[]> {
    const results: ChatProviderToolResultPart[] = []
    let parallel: Array<Promise<void>> = []

    const drainParallel = async (): Promise<void> => {
      await Promise.all(parallel)
      parallel = []
    }

    for (const [index, call] of calls.entries()) {
      signal.throwIfAborted()
      const run = async (): Promise<void> => {
        results[index] = await this.execute(call, signal, onOutputDelta)
      }
      if (this.#tools.get(call.toolName)?.executionMode === 'parallel-safe') {
        parallel.push(run())
        continue
      }
      await drainParallel()
      await run()
    }
    await drainParallel()
    return results
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

export { ToolRegistry, type ToolCall }
