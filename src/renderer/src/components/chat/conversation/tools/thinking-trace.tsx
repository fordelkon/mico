import { Button } from '@mico/ui'
import { LightbulbIcon, ChevronDownIcon } from 'lucide-react'
import * as React from 'react'

type ThinkingTraceProps = {
  excerptText?: string
  id: string
  isStreaming: boolean
  labelOverride?: string
  text: string
}

/** The settled excerpt is taken from the provider's text, never generated separately. */
function ThinkingTrace({
  excerptText,
  id,
  isStreaming,
  labelOverride,
  text
}: ThinkingTraceProps): React.JSX.Element | null {
  // The reasoning part's own lifecycle state gates isStreaming upstream, so the
  // label follows the reasoning-end chunk instead of list position.
  const isThinking = isStreaming
  const [expanded, setExpanded] = React.useState(false)
  const [animateDisclosure, setAnimateDisclosure] = React.useState(false)
  const contentId = `thinking-${id}`
  const label = labelOverride ?? (isThinking ? 'Thinking' : 'Thought')
  const excerpt = !isThinking ? (excerptText ?? text).trim().split('\n')[0].slice(0, 160) : ''

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
        className="agent-activity__trigger hover:bg-transparent hover:text-text-secondary aria-expanded:bg-transparent aria-expanded:text-text-secondary"
        {...(text ? { variant: 'ghost' as const } : {})}
        onClick={(event) => {
          if (!text) return
          setAnimateDisclosure(event.detail > 0)
          setExpanded((current) => !current)
        }}
      >
        <span className="agent-activity__node" data-state={isThinking ? 'running' : undefined}>
          <LightbulbIcon aria-hidden="true" className="size-3.5" />
        </span>
        <span className={isThinking ? 'agent-activity__shimmer' : 'agent-activity__action'}>
          {label}
        </span>
        {!expanded && excerpt ? (
          <span className="thinking-block__excerpt" title={excerpt}>
            {excerpt}
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
          <div className="thinking-block__reading" aria-label="Reasoning" tabIndex={0}>
            {text}
          </div>
        </div>
      </div>
    </section>
  )
}

export { ThinkingTrace, type ThinkingTraceProps }
