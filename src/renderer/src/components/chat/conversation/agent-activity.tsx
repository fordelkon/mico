import { Button } from '@mico/ui'
import { ChevronDownIcon, SparklesIcon } from 'lucide-react'
import * as React from 'react'
import { ThinkingOrb } from 'thinking-orbs'

import { ThinkingTrace } from './tools/thinking-trace'
import { ToolTrace, type ToolActivityPart, type ToolOutputDelta } from './tools/tool-trace'

const thinkingOrbStates = ['working', 'searching', 'solving'] as const

type ThinkingOrbState = (typeof thinkingOrbStates)[number]
type AgentActivityPart = { text: string; type: 'reasoning' } | ToolActivityPart

function getCompletedSummary(parts: AgentActivityPart[]): string {
  const toolCount = parts.filter((part) => part.type === 'dynamic-tool').length
  const summary = [
    toolCount ? `${toolCount} tool call${toolCount === 1 ? '' : 's'}` : null,
    'Agent run'
  ].filter(Boolean)

  return summary.join(' · ') || 'Completed step'
}

function getLiveLabel(parts: AgentActivityPart[]): string {
  const current = parts.at(-1)
  if (current?.type === 'reasoning') return 'Thinking'
  if (current?.type === 'dynamic-tool') return 'Working'
  return 'Thinking'
}

function AgentLoadingIndicator({
  orbState = 'working'
}: {
  orbState?: ThinkingOrbState
}): React.JSX.Element {
  return (
    <section aria-label="Agent activity" className="agent-activity agent-activity--loading">
      <div aria-live="polite" className="agent-activity__live-status">
        <ThinkingOrb
          aria-hidden="true"
          data-orb-state={orbState}
          data-testid="thinking-orb"
          size={20}
          state={orbState}
        />
        <span className="thinking-block__label thinking-block__label--active">Thinking</span>
      </div>
    </section>
  )
}

/**
 * A model step is only an orchestrator: traces own their individual renderers;
 * this component owns chronological order, live-edge following and disclosure.
 */
function AgentActivityTimeline({
  id,
  isAnswerStreaming,
  isStreaming,
  parts
}: {
  id: string
  isAnswerStreaming: boolean
  isStreaming: boolean
  parts: AgentActivityPart[]
}): React.JSX.Element {
  const isLive = isStreaming && !isAnswerStreaming
  const [open, setOpen] = React.useState(false)
  const [hasUserToggled, setHasUserToggled] = React.useState(false)
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const isFollowingLiveEdge = React.useRef(true)
  const wasLive = React.useRef(isLive)
  const expanded = isLive || open
  const contentId = `agent-activity-${id}`
  const label = isLive ? getLiveLabel(parts) : getCompletedSummary(parts)

  React.useEffect(() => {
    if (wasLive.current && !isLive && !hasUserToggled) setOpen(false)
    wasLive.current = isLive
  }, [hasUserToggled, isLive])

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !isLive || !expanded || !isFollowingLiveEdge.current) return

    // Layout can grow after the first paint when a streamed token creates a new
    // line. Assign scrollTop after layout and once more on the next frame so the
    // outer activity viewport, rather than an intermediate child panel, owns the
    // live edge.
    viewport.scrollTop = viewport.scrollHeight
    const frameId = window.requestAnimationFrame(() => {
      const current = viewportRef.current
      if (current && isFollowingLiveEdge.current) current.scrollTop = current.scrollHeight
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [expanded, isLive, parts])

  const handleActivityScroll = (): void => {
    const viewport = viewportRef.current
    if (!viewport) return
    isFollowingLiveEdge.current =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 16
  }

  return (
    <section
      aria-busy={isLive}
      aria-label="Agent activity"
      className={`agent-activity${isLive ? ' agent-activity--live' : ''}`}
      data-open={expanded}
      data-testid="agent-activity-event"
    >
      {isLive ? (
        <div className="agent-activity__live-status" role="status">
          <span aria-hidden="true" className="agent-activity__live-dot" />
          <span className="thinking-block__label thinking-block__label--active">{label}</span>
        </div>
      ) : (
        <Button
          aria-controls={contentId}
          aria-expanded={expanded}
          className="agent-activity__header h-7 gap-1.5 px-1 text-text-tertiary hover:bg-surface-secondary hover:text-foreground aria-expanded:bg-transparent"
          variant="ghost"
          onClick={() => {
            setHasUserToggled(true)
            setOpen((current) => !current)
          }}
        >
          <SparklesIcon aria-hidden="true" className="agent-activity__step-icon size-3.5" />
          <span className="thinking-block__label">{label}</span>
          <ChevronDownIcon aria-hidden="true" className="agent-activity__group-chevron size-3.5" />
        </Button>
      )}
      <div className="agent-activity__body" id={contentId}>
        <div
          aria-hidden={!expanded}
          className={`agent-activity__body-inner${isLive ? ' agent-activity__body-inner--streaming' : ''}`}
          ref={viewportRef}
          role="list"
          onScroll={handleActivityScroll}
        >
          {parts.map((part, index) => (
            <div className="agent-activity__item" key={`${id}-${index}`} role="listitem">
              {part.type === 'reasoning' ? (
                <ThinkingTrace
                  id={`${id}-${index}`}
                  isAnswerStreaming={isAnswerStreaming}
                  // Only the newest part is still streaming: a thought settles as
                  // soon as the model moves on to a tool call or another part.
                  isStreaming={isStreaming && index === parts.length - 1}
                  text={part.text}
                />
              ) : (
                <ToolTrace isFollowedByActivity={index < parts.length - 1} part={part} />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// Compatibility exports keep consumers focused on a single conversation boundary.
const ThinkingBlock = ThinkingTrace

export {
  AgentLoadingIndicator,
  AgentActivityTimeline,
  ThinkingBlock,
  ToolTrace,
  type ToolOutputDelta,
  thinkingOrbStates,
  type AgentActivityPart,
  type ThinkingOrbState
}
