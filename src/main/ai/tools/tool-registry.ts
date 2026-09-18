import type { ChatProviderTool, ChatProviderToolResultPart } from '@mico/ai-providers'

import { createBashTool } from './bash-tool'
import { createEditTool } from './edit-tool'
import { createReadTool } from './read-tool'
import { registerTool, type RegisteredAgentTool, type ToolInput } from './tool-contract'
import { createWriteTool } from './write-tool'

type ToolCall = { toolCallId: string; toolName: string; input: ToolInput }

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

  async execute(call: ToolCall, signal: AbortSignal): Promise<ChatProviderToolResultPart> {
    const tool = this.#tools.get(call.toolName)
    if (!tool) return this.errorResult(call, `Tool "${call.toolName}" is unavailable.`)
    try {
      const result = await tool.execute(call.input, { cwd: this.#cwd, signal })
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
