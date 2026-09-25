import { Button } from '@mico/ui'
import { BrainIcon, ChevronDownIcon } from 'lucide-react'
import * as React from 'react'

type ThinkingTraceProps = {
  id: string
  isStreaming: boolean
  text: string
}

/** A reasoning trace owns streamed text and disclosure; the transcript owns scrolling. */
function ThinkingTrace({ id, isStreaming, text }: ThinkingTraceProps): React.JSX.Element | null {
  // The reasoning part's own lifecycle state gates isStreaming upstream, so the
  // label follows the reasoning-end chunk instead of list position.
  const isThinking = isStreaming
  const [expanded, setExpanded] = React.useState(false)
  const [animateDisclosure, setAnimateDisclosure] = React.useState(false)
  const contentId = `thinking-${id}`
  const label = isThinking ? 'Thinking' : 'Thought'

  if (!text && !isThinking) return null

  const Trigger = text ? Button : 'div'

  return (
    <section
      className="thinking-block agent-activity__trace w-full min-w-0 text-sm text-text-tertiary"
      data-open={expanded}
      data-animate-disclosure={animateDisclosure}
    >
      <Trigger
        aria-label={label}
        aria-controls={text ? contentId : undefined}
        aria-expanded={text ? expanded : undefined}
        className="agent-activity__trigger"
        {...(text ? { variant: 'ghost' as const } : {})}
        onClick={(event) => {
          if (!text) return
          setAnimateDisclosure(event.detail > 0)
          setExpanded((current) => !current)
        }}
      >
        <span className="agent-activity__node">
          <BrainIcon aria-hidden="true" className="size-3.5" />
        </span>
        <span className="agent-activity__action">{label}</span>
        {text ? (
          <span className="agent-activity__summary" title={text}>
            {text}
          </span>
        ) : null}
        {text ? (
          <span aria-hidden="true" className="thinking-block__chevron">
            <ChevronDownIcon className="size-3.5" />
          </span>
        ) : null}
      </Trigger>
      <div className="thinking-block__panel" data-testid="thinking-panel">
        <div
          aria-hidden={!expanded}
          className="thinking-block__panel-inner whitespace-pre-wrap"
          id={contentId}
          inert={!expanded}
        >
          <div className="agent-activity__detail">{text}</div>
        </div>
      </div>
    </section>
  )
}

export { ThinkingTrace, type ThinkingTraceProps }
