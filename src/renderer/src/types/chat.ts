import type { ProviderMetadata, UIMessage } from 'ai'
import type { ChatDocumentPart } from '@shared/data/schemas/chat'
import type { ToolOutputDeltaData } from '@shared/ipc/schemas/chat'

type AssistantCompletionState = 'complete' | 'streaming' | 'stopped'

type MicoMessageMetadata = {
  completionState?: AssistantCompletionState
  providerMetadata?: ProviderMetadata
}

type MicoUIMessage = UIMessage<
  MicoMessageMetadata,
  { document: ChatDocumentPart; 'tool-output-delta': ToolOutputDeltaData }
>

type ChatRetryState = {
  attempt: number
  maxAttempts: number
  retryDelayMs: number
  startedAt: number
}

type Conversation = {
  id: string
  title: string
}

type ActiveChatResponse =
  | { status: 'submitted'; conversationId: string }
  | { status: 'streaming'; conversationId: string }
  | ({ status: 'retrying'; conversationId: string } & ChatRetryState)

type ChatResponseState =
  | { status: 'idle' }
  | ActiveChatResponse
  | { status: 'error'; conversationId: string; message: string }

function isActiveChatResponse(response: ChatResponseState): response is ActiveChatResponse {
  return (
    response.status === 'submitted' ||
    response.status === 'streaming' ||
    response.status === 'retrying'
  )
}

const IDLE_CHAT_RESPONSE = { status: 'idle' } as const satisfies ChatResponseState

export {
  IDLE_CHAT_RESPONSE,
  isActiveChatResponse,
  type ActiveChatResponse,
  type AssistantCompletionState,
  type ChatResponseState,
  type ChatRetryState,
  type Conversation,
  type MicoMessageMetadata,
  type MicoUIMessage
}
