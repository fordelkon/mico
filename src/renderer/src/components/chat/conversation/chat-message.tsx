import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  Bubble,
  BubbleContent,
  IconSwap,
  IconTooltipButton,
  Message,
  MessageContent,
  MessageFooter
} from '@mico/ui'
import type { MicoUIMessage } from '@renderer/types/chat'
import { CheckIcon, CopyIcon, FileTextIcon } from 'lucide-react'
import * as React from 'react'

import { Markdown } from '../../markdown/markdown'
import {
  type AgentActivityPart,
  AgentActivityTimeline,
  AgentLoadingIndicator,
  type ToolActivityPart
} from './agent-activity'

type ChatMessageProps = {
  message: MicoUIMessage
  isStreaming: boolean
  pendingLabel?: string
  showActions?: boolean
}

const textEncoder = new TextEncoder()

type AssistantBlock =
  | { parts: AgentActivityPart[]; type: 'activity' }
  | { text: string; type: 'text' }

type ActivitySourcePart = Extract<
  MicoUIMessage['parts'][number],
  { type: 'reasoning' } | { type: 'dynamic-tool' }
>
type AssistantSourcePart = MicoUIMessage['parts'][number]
type ToolOutputDeltaPart = Extract<AssistantSourcePart, { type: 'data-tool-output-delta' }>

function isActivityPart(part: AssistantSourcePart): part is ActivitySourcePart {
  return part.type === 'reasoning' || part.type === 'dynamic-tool'
}

function isToolOutputDeltaPart(part: AssistantSourcePart): part is ToolOutputDeltaPart {
  return part.type === 'data-tool-output-delta'
}

function groupAssistantParts(parts: ReadonlyArray<AssistantSourcePart>): AssistantBlock[] {
  const toolsById = new Map<string, ToolActivityPart>()
  return parts.reduce<AssistantBlock[]>((blocks, part) => {
    if (isActivityPart(part)) {
      const previous = blocks.at(-1)
      // Consecutive tool/reasoning events share one model step. Any text part is
      // body copy — interim or final — and closes the step before it.
      // Accumulated output belongs to this render, never to the provider's message object.
      const activityPart = { ...part }
      if (activityPart.type === 'dynamic-tool') toolsById.set(activityPart.toolCallId, activityPart)
      if (previous?.type === 'activity') previous.parts.push(activityPart)
      else blocks.push({ parts: [activityPart], type: 'activity' })
    } else if (part.type === 'data-tool-permission') {
      const target = toolsById.get(part.data.toolCallId)
      if (target) target.permission = part.data
    } else if (isToolOutputDeltaPart(part)) {
      const target = toolsById.get(part.data.toolCallId)
      if (target) {
        const liveOutput = target.liveOutput ?? {
          preview: '',
          stderr: '',
          stdout: ''
        }
        liveOutput[part.data.stream] += part.data.delta
        liveOutput.lastStream = part.data.stream
        target.liveOutput = liveOutput
      }
    } else if (part.type === 'text') {
      // An empty text part (a block the model started but never filled) must not
      // close the current agent run or render as an invisible body block.
      if (!part.text) return blocks
      const previous = blocks.at(-1)

      if (previous?.type === 'text') previous.text += part.text
      else blocks.push({ text: part.text, type: 'text' })
    }
    return blocks
  }, [])
}

function ChatMessageComponent({
  message,
  isStreaming,
  pendingLabel,
  showActions = false
}: ChatMessageProps): React.JSX.Element {
  const [copyState, setCopyState] = React.useState<'idle' | 'copied'>('idle')
  const isUser = message.role === 'user'
  const assistantBlocks = isUser ? [] : groupAssistantParts(message.parts)
  const tail = assistantBlocks.at(-1)
  const text = isUser
    ? message.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
    : tail?.type === 'text'
      ? tail.text
      : ''
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
  const canCopy = Boolean(copyText) && (isUser || message.metadata?.completionState === 'complete')

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
    <Message align={isUser ? 'end' : 'start'}>
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
          ? assistantBlocks.map((block, index) => (
              <div className="min-w-0" key={`${message.id}-${index}`}>
                {block.type === 'activity' ? (
                  <AgentActivityTimeline
                    id={`${message.id}-${index}`}
                    // Any later block — interim or final text — closed this step,
                    // so it settles instead of staying live for the rest of the turn.
                    isSettled={index < assistantBlocks.length - 1}
                    isStreaming={isStreaming}
                    parts={block.parts}
                  />
                ) : (
                  <Bubble align="start" variant="ghost" className="w-full">
                    <BubbleContent className="w-full max-w-[42rem] px-0 py-0 font-serif text-base leading-7">
                      <div data-testid="answer-content">
                        {/* Only the tail block still streams; settled interim
                            text must not carry the live caret. */}
                        <Markdown
                          isStreaming={isStreaming && index === assistantBlocks.length - 1}
                          text={block.text}
                        />
                      </div>
                    </BubbleContent>
                  </Bubble>
                )}
              </div>
            ))
          : null}
        {!isUser && isStreaming && !assistantBlocks.length && !documents.length ? (
          <AgentLoadingIndicator label={pendingLabel} />
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
              <div data-testid="answer-content">
                <Markdown isStreaming={isStreaming} text={text} />
              </div>
            </BubbleContent>
          </Bubble>
        ) : null}
        {!isUser && message.metadata?.completionState === 'stopped' ? (
          <div className="chat-process-row" data-tone="neutral" role="status">
            <p className="chat-process-row__label">Response stopped</p>
          </div>
        ) : null}
        {canCopy && (
          <MessageFooter
            className={`min-h-6 text-text-secondary motion-safe:transition-opacity ${showActions ? '' : 'opacity-0 group-hover/message:opacity-100 focus-within:opacity-100'}`}
          >
            <IconTooltipButton
              icon={
                <IconSwap
                  from={<CopyIcon aria-hidden="true" />}
                  state={copyState === 'copied' ? 'to' : 'from'}
                  to={<CheckIcon aria-hidden="true" />}
                />
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
