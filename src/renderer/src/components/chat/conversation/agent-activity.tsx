import { Button } from '@mico/ui'
import type { ReasoningUIPart } from 'ai'
import { ChevronDownIcon, SparklesIcon } from 'lucide-react'
import * as React from 'react'
import { ThinkingOrb } from 'thinking-orbs'

import { ThinkingTrace } from './tools/thinking-trace'
import { ToolTrace, type ToolActivityPart, type ToolOutputDelta } from './tools/tool-trace'

const thinkingOrbStates = ['working', 'searching', 'solving'] as const

type ThinkingOrbState = (typeof thinkingOrbStates)[number]
type AgentActivityPart = ReasoningUIPart | ToolActivityPart

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
        <span className="thinking-block__label">Thinking</span>
      </div>
    </section>
  )
}

/**
 * A model step is only an orchestrator: traces own their individual renderers;
 * this component owns chronological order and disclosure. The message scroller
 * owns live-edge following so nested traces never compete for scroll position.
 */
function AgentActivityTimeline({
  id,
  isSettled = false,
  isStreaming,
  parts
}: {
  id: string
  isSettled?: boolean
  isStreaming: boolean
  parts: AgentActivityPart[]
}): React.JSX.Element {
  // A step stays live for its whole run — reasoning, tools, and the gaps between
  // parts. It settles exactly once, when interim or final text closes the step or
  // the message stops streaming; it must not collapse between individual tools.
  const isLive = isStreaming && !isSettled
  const [open, setOpen] = React.useState(false)
  const [hasUserToggled, setHasUserToggled] = React.useState(false)
  const wasLive = React.useRef(isLive)
  const expanded = isLive || open
  const contentId = `agent-activity-${id}`
  const label = isLive ? getLiveLabel(parts) : getCompletedSummary(parts)

  React.useLayoutEffect(() => {
    // Layout effect: the collapsed commit must land before paint, or the browser
    // flashes one frame of the completed panel before the collapse starts.
    if (wasLive.current && !isLive && !hasUserToggled) setOpen(false)
    wasLive.current = isLive
  }, [hasUserToggled, isLive])

  return (
    <section
      aria-busy={isLive}
      aria-label="Agent activity"
      className="agent-activity"
      data-open={expanded}
      data-user-toggled={hasUserToggled ? 'true' : 'false'}
      data-testid="agent-activity-event"
    >
      {isLive ? (
        <div className="agent-activity__live-status" role="status">
          <span aria-hidden="true" className="agent-activity__live-dot" />
          <span className="thinking-block__label">{label}</span>
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
          className="agent-activity__body-inner"
          inert={!expanded}
          role="list"
        >
          {parts.map((part, index) => (
            <div className="agent-activity__item" key={`${id}-${index}`} role="listitem">
              {part.type === 'reasoning' ? (
                <ThinkingTrace
                  id={`${id}-${index}`}
                  // The label follows the reasoning part's own lifecycle state,
                  // not its position: a thought settles when its stream ends even
                  // if the message keeps streaming past this step.
                  isStreaming={isStreaming && part.state === 'streaming'}
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
