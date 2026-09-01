import { Button } from '@mico/ui'
import { BrainIcon, ChevronDownIcon } from 'lucide-react'
import * as React from 'react'
import { ThinkingOrb } from 'thinking-orbs'

const thinkingOrbStates = ['working', 'searching', 'solving'] as const

type ThinkingBlockProps = {
  id: string
  isAnswerStreaming?: boolean
  isStreaming: boolean
  text: string
}

function ThinkingBlock({
  id,
  isAnswerStreaming = false,
  isStreaming,
  text
}: ThinkingBlockProps): React.JSX.Element | null {
  const isThinking = isStreaming && !isAnswerStreaming
  const [expanded, setExpanded] = React.useState(isThinking)
  const [hasUserToggled, setHasUserToggled] = React.useState(false)
  const [orbState] = React.useState(
    () => thinkingOrbStates[Math.floor(Math.random() * thinkingOrbStates.length)]
  )
  const wasAnswerStreaming = React.useRef(isAnswerStreaming)
  const contentId = `thinking-${id}`
  const label = isThinking ? 'Thinking' : 'Thought summary'

  React.useEffect(() => {
    if (isAnswerStreaming && !wasAnswerStreaming.current && !hasUserToggled) {
      setExpanded(false)
    }

    wasAnswerStreaming.current = isAnswerStreaming
  }, [hasUserToggled, isAnswerStreaming])

  if (!text && !isThinking) return null

  return (
    <section
      className="thinking-block max-w-[42rem] text-sm text-text-tertiary"
      data-open={expanded}
    >
      <Button
        aria-controls={contentId}
        aria-expanded={expanded}
        className="h-auto gap-2 px-0 py-1 text-text-tertiary hover:bg-transparent hover:text-foreground"
        variant="ghost"
        onClick={() => {
          setHasUserToggled(true)
          setExpanded((current) => !current)
        }}
      >
        <span
          className="thinking-block__icon-swap"
          data-state={isThinking ? 'thinking' : 'complete'}
        >
          <ThinkingOrb
            aria-hidden="true"
            className="thinking-block__icon thinking-block__orb"
            data-orb-state={orbState}
            data-testid="thinking-orb"
            size={20}
            state={orbState}
          />
          <BrainIcon
            aria-hidden="true"
            className="thinking-block__icon thinking-block__brain size-3.5"
          />
        </span>
        <span
          className={
            isThinking
              ? 'thinking-block__label thinking-block__label--active'
              : 'thinking-block__label'
          }
          data-text={label}
        >
          {label}
        </span>
        <span aria-hidden="true" className="thinking-block__chevron">
          <ChevronDownIcon className="size-3.5" />
        </span>
      </Button>
      <div className="thinking-block__panel" data-testid="thinking-panel">
        <div
          aria-hidden={!expanded}
          className="thinking-block__panel-inner whitespace-pre-wrap rounded-md bg-surface-secondary px-3 py-2"
          id={contentId}
        >
          {text}
        </div>
      </div>
    </section>
  )
}

export { ThinkingBlock }
