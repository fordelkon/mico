import type { ChatProviderTool, JsonObject } from '@mico/ai-providers'

import type * as z from 'zod'

const MAX_READ_BYTES = 256 * 1024
const MAX_READ_LINES = 2_000
const MAX_WRITE_BYTES = 1024 * 1024
const MAX_EDIT_REPLACEMENTS = 100
const MAX_BASH_OUTPUT_BYTES = 256 * 1024
const DEFAULT_BASH_TIMEOUT_SECONDS = 30

type ToolExecutionContext = { cwd: string; signal: AbortSignal }
type ToolExecutionResult = { output: string }
/** Complete fact emitted once a tool call has settled. */
type ToolExecutionTrace = {
  toolCallId: string
  toolName: string
  input: ToolInput
  isError: boolean
  output: string
  startedAt: number
  finishedAt: number
}
type ToolExecutionMode = 'parallel-safe' | 'exclusive'
type ToolInput = JsonObject
type AgentTool<Input> = {
  definition: ChatProviderTool
  inputSchema: z.ZodType<Input>
  executionMode?: ToolExecutionMode
  execute: (input: Input, context: ToolExecutionContext) => Promise<ToolExecutionResult>
}
type RegisteredAgentTool = {
  definition: ChatProviderTool
  executionMode: ToolExecutionMode
  execute: (input: ToolInput, context: ToolExecutionContext) => Promise<ToolExecutionResult>
}

function registerTool<Input>(tool: AgentTool<Input>): RegisteredAgentTool {
  return {
    definition: tool.definition,
    executionMode: tool.executionMode ?? 'exclusive',
    async execute(input, context) {
      const parsed = tool.inputSchema.safeParse(input)
      if (!parsed.success) throw new Error('Invalid tool input.')
      return tool.execute(parsed.data, context)
    }
  }
}

export {
  DEFAULT_BASH_TIMEOUT_SECONDS,
  MAX_BASH_OUTPUT_BYTES,
  MAX_EDIT_REPLACEMENTS,
  MAX_READ_BYTES,
  MAX_READ_LINES,
  MAX_WRITE_BYTES,
  type AgentTool,
  type RegisteredAgentTool,
  type ToolExecutionContext,
  type ToolExecutionMode,
  type ToolExecutionResult,
  type ToolExecutionTrace,
  type ToolInput,
  registerTool
}
