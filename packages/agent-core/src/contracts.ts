import type {
  ChatProviderAssistantMessage,
  ChatProviderToolResultPart,
  JsonObject,
  ProviderUsage
} from '@mico/ai-providers'

interface ToolCall {
  toolCallId: string
  toolName: string
  input: JsonObject
}

interface ToolExecutionTrace extends ToolCall {
  output: string
  isError: boolean
  startedAt: number
  finishedAt: number
}

interface ToolOutputDelta {
  toolCallId: string
  toolName: string
  stream: 'preview' | 'stderr' | 'stdout'
  delta: string
}

interface ToolExecution {
  result: ChatProviderToolResultPart
  trace: ToolExecutionTrace
}

interface ToolExecutionCallbacks {
  onExecutionStarted?: (call: ToolCall, startedAt: number) => void
  onExecutionSettled?: (execution: ToolExecution) => void
}

/** Execution only needs dispatch; tool registration and request budgets belong to callers. */
interface ToolExecutionPort {
  executeBatch(
    calls: readonly ToolCall[],
    signal: AbortSignal,
    onOutputDelta?: (delta: ToolOutputDelta) => void,
    callbacks?: ToolExecutionCallbacks
  ): Promise<ToolExecution[]>
}

interface AgentStep {
  index: number
  assistant: ChatProviderAssistantMessage
  toolResults: ChatProviderToolResultPart[]
  continuationPrompt?: string
}

interface ModelStepAccepted {
  index: number
  assistant: ChatProviderAssistantMessage
  usage?: ProviderUsage
}

interface ToolExecutionStarted {
  index: number
  toolCallId: string
  startedAt: number
}

interface ToolExecutionSettled extends ToolExecution {
  index: number
}

/** Synchronous acknowledgements may reject execution before a side effect begins. */
interface ExecutionJournal {
  recordModelStep: (step: ModelStepAccepted) => void
  recordToolExecutionStarted: (execution: ToolExecutionStarted) => void
  recordToolExecutionSettled: (execution: ToolExecutionSettled) => void
}

export type {
  AgentStep,
  ExecutionJournal,
  ModelStepAccepted,
  ToolCall,
  ToolExecution,
  ToolExecutionCallbacks,
  ToolExecutionPort,
  ToolExecutionSettled,
  ToolExecutionStarted,
  ToolExecutionTrace,
  ToolOutputDelta
}
