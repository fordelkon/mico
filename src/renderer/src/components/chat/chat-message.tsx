import {
  Bubble,
  BubbleContent,
  IconTooltipButton,
  Message,
  MessageContent,
  MessageFooter
} from '@mico/ui'
import type { MicoUIMessage } from '@renderer/lib/ai/chat-types'
import { CheckIcon, CopyIcon } from 'lucide-react'
import * as React from 'react'

type ChatMessageProps = {
  message: MicoUIMessage
  isStreaming: boolean
}

function ChatMessage({ message, isStreaming }: ChatMessageProps): React.JSX.Element {
  const [copyState, setCopyState] = React.useState<'idle' | 'copied'>('idle')
  const text = message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
  const isUser = message.role === 'user'
  const canCopy = isUser || message.metadata?.completionState === 'complete'

  React.useEffect(() => {
    if (copyState !== 'copied') return

    const timeoutId = window.setTimeout(() => setCopyState('idle'), 2_000)
    return () => window.clearTimeout(timeoutId)
  }, [copyState])

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(text).then(
      () => setCopyState('copied'),
      () => setCopyState('idle')
    )
  }

  return (
    <Message align={isUser ? 'end' : 'start'}>
      <MessageContent className="gap-1.5">
        <Bubble
          align={isUser ? 'end' : 'start'}
          variant={isUser ? 'secondary' : 'ghost'}
          className={
            isUser
              ? '*:data-[slot=bubble-content]:bg-chat-user *:data-[slot=bubble-content]:text-chat-user-foreground'
              : undefined
          }
        >
          <BubbleContent
            className={
              isUser
                ? 'rounded-[var(--radius-message)] px-4 py-2.5 font-sans shadow-none'
                : 'max-w-[42rem] px-0 py-0 font-serif text-base leading-7'
            }
          >
            <p className="whitespace-pre-wrap">{text}</p>
            {isStreaming && (
              <span
                aria-hidden="true"
                className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-brand motion-reduce:animate-none"
              />
            )}
          </BubbleContent>
        </Bubble>
        {canCopy && (
          <MessageFooter className="min-h-6 text-text-tertiary opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
            <IconTooltipButton
              icon={
                copyState === 'copied' ? (
                  <CheckIcon aria-hidden="true" />
                ) : (
                  <CopyIcon aria-hidden="true" />
                )
              }
              label="Copy message"
              size="icon-xs"
              tooltip={copyState === 'copied' ? 'Copied' : 'Copy message'}
              onClick={handleCopy}
            />
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  )
}

export { ChatMessage }
