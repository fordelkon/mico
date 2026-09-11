import {
  Bubble,
  BubbleContent,
  IconTooltipButton,
  Message,
  MessageContent,
  MessageFooter
} from '@mico/ui'
import type { MicoUIMessage } from '@renderer/types/chat'
import { CheckIcon, CopyIcon } from 'lucide-react'
import * as React from 'react'

import { ChatMarkdown } from '../markdown/chat-markdown'
import { ThinkingBlock, type ThinkingOrbState } from './thinking-block'

type ChatMessageProps = {
  message: MicoUIMessage
  isStreaming: boolean
  thinkingOrbState?: ThinkingOrbState
}

function ChatMessageComponent({
  message,
  isStreaming,
  thinkingOrbState
}: ChatMessageProps): React.JSX.Element {
  const [copyState, setCopyState] = React.useState<'idle' | 'copied'>('idle')
  const text = message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
  const reasoningParts = message.parts.filter(
    (part): part is Extract<typeof part, { type: 'reasoning' }> => part.type === 'reasoning'
  )
  const isUser = message.role === 'user'
  const canCopy = isUser || message.metadata?.completionState === 'complete'

  // Keep copy confirmation transient so repeated copies retain clear feedback.
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
    <Message align={isUser ? 'end' : 'start'} className={isUser ? 'chat-message--sent' : undefined}>
      <MessageContent className="gap-1.5">
        {!isUser &&
          (reasoningParts.length > 0
            ? reasoningParts.map((part, index) => (
                <ThinkingBlock
                  id={`${message.id}-${index}`}
                  isAnswerStreaming={isStreaming && Boolean(text)}
                  isStreaming={isStreaming}
                  key={`${message.id}-${index}`}
                  orbState={thinkingOrbState}
                  text={part.text}
                />
              ))
            : isStreaming &&
              !text && (
                <ThinkingBlock id={message.id} isStreaming orbState={thinkingOrbState} text="" />
              ))}
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
                ? 'rounded-[var(--radius-message)] px-4 py-2.5'
                : 'w-full max-w-[42rem] px-0 py-0 font-serif text-base leading-7'
            }
          >
            <ChatMarkdown isStreaming={isStreaming} text={text} />
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

const ChatMessage = React.memo(ChatMessageComponent)

export { ChatMessage }
