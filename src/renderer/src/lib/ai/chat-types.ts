import type { UIMessage } from 'ai'

type AssistantCompletionState = 'complete' | 'streaming' | 'stopped'

type MicoMessageMetadata = {
  completionState?: AssistantCompletionState
}

type MicoUIMessage = UIMessage<MicoMessageMetadata>

type Conversation = {
  id: string
  title: string
}

type ChatResponseState =
  | { status: 'idle' }
  | {
      status: 'submitted' | 'streaming'
      conversationId: string
    }

const IDLE_CHAT_RESPONSE = { status: 'idle' } as const satisfies ChatResponseState

export {
  IDLE_CHAT_RESPONSE,
  type AssistantCompletionState,
  type ChatResponseState,
  type Conversation,
  type MicoMessageMetadata,
  type MicoUIMessage
}
