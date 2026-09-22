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
  const [expanded, setExpanded] = React.useState(isThinking)
  const [hasUserToggled, setHasUserToggled] = React.useState(false)
  const wasThinking = React.useRef(isThinking)
  const contentId = `thinking-${id}`
  const label = isThinking ? 'Thinking' : 'Thought'

  React.useLayoutEffect(() => {
    // A thought settles like a completed tool: the panel collapses once reasoning
    // hands over to the next activity part.
    // Layout effect: the collapsed commit must land before paint, or the browser
    // flashes one frame of the completed panel before the collapse starts.
    if (wasThinking.current && !isThinking && !hasUserToggled) setExpanded(false)
    wasThinking.current = isThinking
  }, [hasUserToggled, isThinking])

  if (!text && !isThinking) return null

  return (
    <section
      className="thinking-block agent-activity__trace w-full min-w-0 text-sm text-text-tertiary"
      data-open={expanded}
      data-user-toggled={hasUserToggled ? 'true' : 'false'}
    >
      <Button
        aria-label={label}
        aria-controls={contentId}
        aria-expanded={expanded}
        className="agent-activity__trigger h-7 w-full min-w-0 gap-2 px-1 hover:text-foreground"
        variant="ghost"
        onClick={() => {
          setHasUserToggled(true)
          setExpanded((current) => !current)
        }}
      >
        <BrainIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="thinking-block__label">{label}</span>
        {text ? (
          <span className="agent-activity__summary" title={text}>
            {text}
          </span>
        ) : null}
        <span aria-hidden="true" className="thinking-block__chevron">
          <ChevronDownIcon className="size-3.5" />
        </span>
      </Button>
      <div className="thinking-block__panel" data-testid="thinking-panel">
        <div
          aria-hidden={!expanded}
          className="thinking-block__panel-inner whitespace-pre-wrap"
          id={contentId}
          inert={!expanded}
        >
          {text}
        </div>
      </div>
    </section>
  )
}

export { ThinkingTrace, type ThinkingTraceProps }
