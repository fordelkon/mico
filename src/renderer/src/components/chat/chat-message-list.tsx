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
import { LoaderCircleIcon } from 'lucide-react'
import * as React from 'react'

import { ChatMessage } from './chat-message'
import { thinkingOrbStates, type ThinkingOrbState } from './thinking-block'

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

function ChatMessageList({
  conversationId,
  errorMessage,
  messages,
  isResponding,
  onRetry,
  retry
}: ChatMessageListProps): React.JSX.Element {
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (!retry) return

    const intervalId = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(intervalId)
  }, [retry])

  const remainingSeconds = retry
    ? Math.max(0, Math.ceil((retry.startedAt + retry.retryDelayMs - now) / 1_000))
    : 0
  const showPendingThinking = isResponding && messages.at(-1)?.role !== 'assistant'

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
            <ThinkingOrbStateScope key={isResponding ? 'responding' : 'idle'}>
              {(thinkingOrbState) => (
                <>
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
                        thinkingOrbState={thinkingOrbState}
                      />
                    </MessageScrollerItem>
                  ))}
                  {showPendingThinking && (
                    <MessageScrollerItem messageId="pending-assistant">
                      <ChatMessage
                        isStreaming
                        message={{ id: 'pending-assistant', role: 'assistant', parts: [] }}
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
            {retry && (
              <p className="flex items-center gap-2 text-sm text-text-tertiary" role="status">
                <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
                {remainingSeconds > 0
                  ? `Connection interrupted. Retrying in ${remainingSeconds}s · attempt ${retry.attempt} of ${retry.maxAttempts}.`
                  : `Connection interrupted. Retrying · attempt ${retry.attempt} of ${retry.maxAttempts}.`}
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
