import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@mico/ui'

import type { MicoUIMessage } from '@renderer/types/chat'

import { ChatMessage } from './chat-message'

type ChatMessageListProps = {
  conversationId: string
  errorMessage?: string
  messages: MicoUIMessage[]
  isResponding: boolean
}

function ChatMessageList({
  conversationId,
  errorMessage,
  messages,
  isResponding
}: ChatMessageListProps): React.JSX.Element {
  return (
    <MessageScrollerProvider key={conversationId} autoScroll defaultScrollPosition="end">
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent
            aria-busy={isResponding}
            className="mx-auto w-full max-w-[46rem] gap-8 px-5 pb-10 pt-12 sm:px-8"
          >
            {messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.role === 'user'}
              >
                <ChatMessage
                  message={message}
                  isStreaming={
                    isResponding &&
                    message.role === 'assistant' &&
                    message.id === messages.at(-1)?.id
                  }
                />
              </MessageScrollerItem>
            ))}
            {errorMessage && (
              <p
                className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive"
                role="alert"
              >
                {errorMessage}
              </p>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton className="bottom-5 size-8 rounded-full border-border-subtle bg-surface-primary shadow-sm" />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

export { ChatMessageList }
