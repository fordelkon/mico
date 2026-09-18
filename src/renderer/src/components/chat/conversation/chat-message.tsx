import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  Bubble,
  BubbleContent,
  IconTooltipButton,
  Message,
  MessageContent,
  MessageFooter
} from '@mico/ui'
import type { MicoUIMessage } from '@renderer/types/chat'
import { CheckIcon, CopyIcon, FileTextIcon } from 'lucide-react'
import * as React from 'react'

import { ChatMarkdown } from '../markdown/chat-markdown'
import { ThinkingBlock, ToolTrace, type ThinkingOrbState } from './agent-activity'

type ChatMessageProps = {
  message: MicoUIMessage
  isStreaming: boolean
  thinkingOrbState?: ThinkingOrbState
}

const textEncoder = new TextEncoder()

function isFollowedByActivity(parts: MicoUIMessage['parts'], index: number): boolean {
  return parts.slice(index + 1).some((part) => {
    if (part.type === 'dynamic-tool') return true
    return (part.type === 'reasoning' || part.type === 'text') && Boolean(part.text)
  })
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
  const isUser = message.role === 'user'
  const documents = message.parts
    .filter((part) => part.type === 'data-document')
    .map(({ data }) => {
      const bytes = textEncoder.encode(data.text).byteLength
      return {
        name: data.name,
        size: `${bytes.toLocaleString('en-US')} ${bytes === 1 ? 'byte' : 'bytes'}`
      }
    })
  const copyText = [
    text,
    documents.map(({ name, size }) => `Attached document: ${name} (${size})`).join('\n')
  ]
    .filter(Boolean)
    .join('\n\n')
  const canCopy = isUser || message.metadata?.completionState === 'complete'

  // Keep copy confirmation transient so repeated copies retain clear feedback.
  React.useEffect(() => {
    if (copyState !== 'copied') return

    const timeoutId = window.setTimeout(() => setCopyState('idle'), 2_000)
    return () => window.clearTimeout(timeoutId)
  }, [copyState])

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(copyText).then(
      () => setCopyState('copied'),
      () => setCopyState('idle')
    )
  }

  return (
    <Message align={isUser ? 'end' : 'start'} className={isUser ? 'chat-message--sent' : undefined}>
      <MessageContent className="gap-1.5">
        {documents.length > 0 ? (
          <AttachmentGroup aria-label="Attached documents">
            {documents.map(({ name, size }, index) => (
              <Attachment key={`${message.id}-${index}`} size="sm" className="max-w-72">
                <AttachmentMedia>
                  <FileTextIcon aria-hidden="true" />
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle title={name}>{name}</AttachmentTitle>
                  <AttachmentDescription>{size}</AttachmentDescription>
                </AttachmentContent>
              </Attachment>
            ))}
          </AttachmentGroup>
        ) : null}
        {!isUser
          ? message.parts.map((part, index) => {
              const key = `${message.id}-${index}`
              if (part.type === 'reasoning')
                return (
                  <div
                    className="agent-activity__event"
                    data-testid="agent-activity-event"
                    key={key}
                  >
                    <ThinkingBlock
                      id={key}
                      isAnswerStreaming={isStreaming && Boolean(text)}
                      isStreaming={isStreaming}
                      orbState={thinkingOrbState}
                      text={part.text}
                    />
                  </div>
                )
              if (part.type === 'dynamic-tool')
                return (
                  <div
                    className="agent-activity__event"
                    data-testid="agent-activity-event"
                    key={key}
                  >
                    <ToolTrace
                      part={part}
                      isFollowedByActivity={isFollowedByActivity(message.parts, index)}
                    />
                  </div>
                )
              if (part.type !== 'text') return null
              return (
                <div className="agent-activity__event" data-testid="agent-activity-event" key={key}>
                  <Bubble align="start" variant="ghost">
                    <BubbleContent className="w-full max-w-[42rem] px-0 py-0 font-serif text-base leading-7">
                      <ChatMarkdown isStreaming={isStreaming} text={part.text} />
                    </BubbleContent>
                  </Bubble>
                </div>
              )
            })
          : null}
        {!isUser && isStreaming && !message.parts.length ? (
          <ThinkingBlock id={message.id} isStreaming orbState={thinkingOrbState} text="" />
        ) : null}
        {isUser && (text || !documents.length) ? (
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
        ) : null}
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
