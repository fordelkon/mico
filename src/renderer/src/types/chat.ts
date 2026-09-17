import type { ProviderMetadata, UIMessage } from 'ai'
import type { ChatDocumentPart } from '@shared/data/schemas/chat'

type AssistantCompletionState = 'complete' | 'streaming' | 'stopped'

type MicoMessageMetadata = {
  completionState?: AssistantCompletionState
  providerMetadata?: ProviderMetadata
}

type MicoUIMessage = UIMessage<MicoMessageMetadata, { document: ChatDocumentPart }>

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

type ChatResponseState =
  | { status: 'idle' }
  | { status: 'error'; conversationId: string; message: string }
  | ({ status: 'retrying'; conversationId: string } & ChatRetryState)
  | {
      status: 'submitted' | 'streaming'
      conversationId: string
    }

const IDLE_CHAT_RESPONSE = { status: 'idle' } as const satisfies ChatResponseState

export {
  IDLE_CHAT_RESPONSE,
  type AssistantCompletionState,
  type ChatResponseState,
  type ChatRetryState,
  type Conversation,
  type MicoMessageMetadata,
  type MicoUIMessage
}
