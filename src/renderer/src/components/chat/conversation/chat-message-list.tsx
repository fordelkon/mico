import {
  Button,
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@mico/ui'

import type { ChatRetryState, MicoUIMessage } from '@renderer/types/chat'
import { Chat, useChat } from '@ai-sdk/react'
import { LoaderCircleIcon } from 'lucide-react'
import * as React from 'react'

import { ChatMessage } from './chat-message'
import { thinkingOrbStates, type ThinkingOrbState } from './thinking-block'

// A bounded commit rate keeps long streamed Markdown from exhausting the renderer.
const STREAMING_UPDATE_THROTTLE_MS = 50
const PENDING_ASSISTANT_MESSAGE = {
  id: 'pending-assistant',
  role: 'assistant',
  parts: []
} satisfies MicoUIMessage

function getRandomThinkingOrbState(): ThinkingOrbState {
  return thinkingOrbStates[Math.floor(Math.random() * thinkingOrbStates.length)]
}

function ThinkingOrbStateScope({
  children
}: {
  children: (thinkingOrbState: ThinkingOrbState) => React.ReactNode
}): React.JSX.Element {
  const [thinkingOrbState] = React.useState(getRandomThinkingOrbState)

  return <>{children(thinkingOrbState)}</>
}

type ChatMessageListProps = {
  conversationId: string
  errorMessage?: string
  messages: MicoUIMessage[]
  isResponding: boolean
  onRetry?: () => void
  retry?: ChatRetryState
}

type SubscribedChatMessageListProps = Omit<ChatMessageListProps, 'messages'> & {
  chat: Chat<MicoUIMessage>
}

type RetryProgressStyle = React.CSSProperties & { '--retry-delay': string }

function ChatRetryStatus({ retry }: { retry: ChatRetryState }): React.JSX.Element {
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(intervalId)
  }, [])

  const remainingSeconds = Math.max(
    0,
    Math.ceil((retry.startedAt + retry.retryDelayMs - now) / 1_000)
  )
  const retryProgressStyle: RetryProgressStyle = {
    '--retry-delay': `${retry.retryDelayMs}ms`
  }

  return (
    <p
      className="chat-retry-status flex items-center gap-2 text-sm text-text-tertiary"
      role="status"
    >
      <span
        aria-hidden="true"
        className="chat-retry-progress"
        data-testid="retry-progress"
        key={retry.startedAt}
        style={retryProgressStyle}
      />
      <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
      {remainingSeconds > 0
        ? `Connection interrupted. Retrying in ${remainingSeconds}s · attempt ${retry.attempt} of ${retry.maxAttempts}.`
        : `Connection interrupted. Retrying · attempt ${retry.attempt} of ${retry.maxAttempts}.`}
    </p>
  )
}

function ChatMessageList({
  conversationId,
  errorMessage,
  messages,
  isResponding,
  onRetry,
  retry
}: ChatMessageListProps): React.JSX.Element {
  const latestMessage = messages.at(-1)
  const hasEmptyAssistantMessage =
    isResponding && latestMessage?.role === 'assistant' && latestMessage.parts.length === 0
  const showPendingThinking =
    isResponding && (latestMessage?.role !== 'assistant' || hasEmptyAssistantMessage)
  const displayedMessages = hasEmptyAssistantMessage ? messages.slice(0, -1) : messages

  return (
    <MessageScrollerProvider key={conversationId} autoScroll defaultScrollPosition="end">
      <MessageScroller
        className="chat-message-scroller"
        data-streaming={isResponding ? 'true' : undefined}
      >
        <MessageScrollerViewport>
          <MessageScrollerContent
            aria-busy={isResponding}
            className="mx-auto w-full max-w-[46rem] gap-8 px-5 pb-10 pt-12 sm:px-8"
          >
            {/* Preserve the mounted transcript when a response completes so the browser retains scroll position. */}
            <ThinkingOrbStateScope>
              {(thinkingOrbState) => (
                <>
                  {displayedMessages.map((message) => (
                    <MessageScrollerItem key={message.id} messageId={message.id}>
                      <ChatMessage
                        message={message}
                        isStreaming={
                          isResponding &&
                          message.role === 'assistant' &&
                          message.id === latestMessage?.id
                        }
                        thinkingOrbState={thinkingOrbState}
                      />
                    </MessageScrollerItem>
                  ))}
                  {showPendingThinking && (
                    <MessageScrollerItem messageId="pending-assistant">
                      <ChatMessage
                        isStreaming
                        message={PENDING_ASSISTANT_MESSAGE}
                        thinkingOrbState={thinkingOrbState}
                      />
                    </MessageScrollerItem>
                  )}
                </>
              )}
            </ThinkingOrbStateScope>
            {errorMessage && (
              <div
                className="flex items-center justify-between gap-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive"
                role="alert"
              >
                <p>{errorMessage}</p>
                {onRetry && (
                  <Button size="sm" variant="outline" onClick={onRetry}>
                    Try again
                  </Button>
                )}
              </div>
            )}
            {retry && <ChatRetryStatus retry={retry} />}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton
          className="bottom-5 size-8 rounded-full border-border-subtle bg-surface-primary shadow-sm"
          data-streaming={isResponding ? 'true' : undefined}
        />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

function SubscribedChatMessageList({
  chat,
  ...props
}: SubscribedChatMessageListProps): React.JSX.Element {
  const { messages } = useChat<MicoUIMessage>({
    chat,
    throttle: STREAMING_UPDATE_THROTTLE_MS
  })

  return <ChatMessageList {...props} messages={messages} />
}

export { ChatMessageList, SubscribedChatMessageList }
