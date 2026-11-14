import type {
  ChatProviderMessage,
  ChatProviderStreamInput,
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

interface ToolOutputDeltaData {
  toolCallId: string
  toolName: string
  stream: 'preview' | 'stderr' | 'stdout'
  delta: string
}

type ToolOutputDelta = ToolOutputDeltaData

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
  assistant: Extract<ChatProviderMessage, { role: 'assistant' }>
  toolResults: ChatProviderToolResultPart[]
  continuationPrompt?: string
}

interface ModelStepAccepted {
  index: number
  assistant: AgentStep['assistant']
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

type PreparedStep = Pick<ChatProviderStreamInput, 'messages' | 'tools'>
type PrepareStep = (history: readonly ChatProviderMessage[]) => PreparedStep

export type {
  AgentStep,
  ExecutionJournal,
  ModelStepAccepted,
  PreparedStep,
  PrepareStep,
  ToolCall,
  ToolExecution,
  ToolExecutionCallbacks,
  ToolExecutionPort,
  ToolExecutionSettled,
  ToolExecutionStarted,
  ToolExecutionTrace,
  ToolOutputDelta,
  ToolOutputDeltaData
}
