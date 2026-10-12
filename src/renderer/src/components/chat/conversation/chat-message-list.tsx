import {
  Button,
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  Spinner
} from '@mico/ui'

import type { ChatRetryState, MicoUIMessage } from '@renderer/types/chat'
import type { TurnFailureCode } from '@shared/ai/turn-failure'
import { Chat, useChat } from '@ai-sdk/react'
import { CircleAlertIcon } from 'lucide-react'
import * as React from 'react'

import { ChatMessage } from './chat-message'

// A bounded commit rate keeps long streamed Markdown from exhausting the renderer.
const STREAMING_UPDATE_THROTTLE_MS = 50
const PENDING_ASSISTANT_MESSAGE = {
  id: 'pending-assistant',
  role: 'assistant',
  parts: []
} satisfies MicoUIMessage

/**
 * Readable headings for the persisted failure vocabulary; the detail message
 * still names the specific cause. Outcomes without a persisted kind — live
 * transport errors — stay neutral instead of guessing.
 */
const OUTCOME_HEADINGS = {
  provider_error: 'The model provider request failed',
  step_limit: 'The model reached its step limit',
  token_limit: 'The model reached its output token limit',
  aborted: 'The response was stopped',
  no_model: 'No model is selected',
  process_interrupted: 'The app was closed during the response'
} satisfies Record<TurnFailureCode, string>

type ChatMessageListProps = {
  conversationId: string
  errorMessage?: string
  failureCode?: TurnFailureCode
  isThinkingEnabled?: boolean
  messages: MicoUIMessage[]
  isResponding: boolean
  onRetry?: () => void
  retry?: ChatRetryState
  status?: React.ReactNode
}

type SubscribedChatMessageListProps = Omit<ChatMessageListProps, 'messages'> & {
  chat: Chat<MicoUIMessage>
}

type RetryProgressStyle = React.CSSProperties & { '--retry-delay': string }

/**
 * One compact live process row for a scheduled retry; the spinner is real work.
 * The spoken announcement stays stable while the visible countdown ticks, so
 * assistive tech hears one retry notice instead of a new one every 250 ms.
 */
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
    <div className="chat-process-row" data-live="true">
      <span aria-hidden="true" className="chat-process-row__node">
        <Spinner className="size-3.5" />
      </span>
      <p className="chat-process-row__label">
        <span aria-hidden="true">
          {remainingSeconds > 0
            ? `Retrying in ${remainingSeconds}s · attempt ${retry.attempt} of ${retry.maxAttempts}.`
            : `Retrying · attempt ${retry.attempt} of ${retry.maxAttempts}.`}
        </span>
        <span className="sr-only" role="status">
          Retrying · attempt {retry.attempt} of {retry.maxAttempts}.
        </span>
      </p>
      <span
        aria-hidden="true"
        className="chat-retry-progress"
        data-testid="retry-progress"
        key={retry.startedAt}
        style={retryProgressStyle}
      />
    </div>
  )
}

function ChatMessageList({
  conversationId,
  errorMessage,
  failureCode,
  isThinkingEnabled = true,
  messages,
  isResponding,
  onRetry,
  retry,
  status
}: ChatMessageListProps): React.JSX.Element {
  const latestMessage = messages.at(-1)
  const hasEmptyAssistantMessage =
    isResponding && latestMessage?.role === 'assistant' && latestMessage.parts.length === 0
  // The pending row marks the gap before any content: "Thinking" names the
  // expected first activity, and a plain "Working" covers thinking-off sessions
  // so the wait stays visible either way.
  const showPendingActivity =
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
                  />
                </MessageScrollerItem>
              ))}
              {showPendingActivity && (
                <MessageScrollerItem messageId="pending-assistant">
                  <ChatMessage
                    isStreaming
                    message={PENDING_ASSISTANT_MESSAGE}
                    pendingLabel={isThinkingEnabled ? undefined : 'Working'}
                  />
                </MessageScrollerItem>
              )}
            </>
            {errorMessage && (
              <div className="agent-turn-outcome" role="alert">
                <CircleAlertIcon aria-hidden="true" className="size-4 flex-none" />
                <div className="min-w-0 flex-1">
                  {/* Persisted recovery names the failure kind in the heading;
                      live transport errors keep the neutral wording, and the
                      detail message names what actually happened either way. */}
                  <div className="agent-turn-outcome__heading">
                    {failureCode ? OUTCOME_HEADINGS[failureCode] : 'Response interrupted'}
                  </div>
                  <p className="agent-turn-outcome__detail">{errorMessage}</p>
                </div>
                {onRetry && (
                  <Button size="sm" variant="outline" onClick={onRetry}>
                    Try again
                  </Button>
                )}
              </div>
            )}
            {retry && <ChatRetryStatus retry={retry} />}
            {status}
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
