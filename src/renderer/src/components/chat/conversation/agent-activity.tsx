import { Button } from '@mico/ui'
import type { ReasoningUIPart } from 'ai'
import { CheckIcon, ChevronDownIcon, CircleAlertIcon } from 'lucide-react'
import * as React from 'react'

import { ThinkingTrace } from './tools/thinking-trace'
import {
  getToolActivityState,
  getToolActivityLabel,
  ToolTrace,
  type ToolActivityPart,
  type ToolOutputDelta
} from './tools/tool-trace'

type AgentActivityPart = ReasoningUIPart | ToolActivityPart

function AgentLoadingIndicator(): React.JSX.Element {
  return (
    <section aria-label="Agent activity" className="agent-activity agent-activity--loading">
      <div className="agent-activity__live-status" role="status">
        <span aria-hidden="true" className="agent-activity__live-dot" />
        <span>Thinking</span>
      </div>
    </section>
  )
}

/** The timeline owns order and disclosure; the transcript owns scroll following. */
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
  const isLive = isStreaming && !isSettled
  // Initialize from the mounting context only. Settling must not displace content
  // or override a user's choice; historical runs start compact when revisited.
  const [expanded, setExpanded] = React.useState(isLive)
  const [animateDisclosure, setAnimateDisclosure] = React.useState(false)
  const contentId = `agent-activity-${id}`
  const tools = parts.filter((part): part is ToolActivityPart => part.type === 'dynamic-tool')
  const failed = tools.filter((part) => getToolActivityState(part, isLive) === 'failed').length
  const incomplete = tools.filter(
    (part) => getToolActivityState(part, isLive) === 'incomplete'
  ).length
  const active = tools.filter((part) =>
    ['preparing', 'executing', 'streaming-output'].includes(getToolActivityState(part, isLive))
  )
  const summary = tools.length
    ? `${tools.length} tool call${tools.length === 1 ? '' : 's'}`
    : 'Reasoning finished'
  const liveLabel =
    active.length > 1
      ? `Running ${active.length} tools`
      : active.length === 1
        ? getToolActivityLabel(active[0])
        : parts.some((part) => part.type === 'reasoning' && part.state === 'streaming') ||
            !parts.length
          ? 'Thinking'
          : 'Working'
  const label = [
    isLive ? liveLabel : summary,
    failed ? `${failed} failed` : null,
    incomplete ? `${incomplete} not completed` : null
  ]
    .filter(Boolean)
    .join(' · ')
  const OutcomeIcon = failed || incomplete ? CircleAlertIcon : CheckIcon

  return (
    <section
      aria-label="Agent activity"
      className="agent-activity"
      data-open={expanded}
      data-animate-disclosure={animateDisclosure}
      data-testid="agent-activity-event"
    >
      <Button
        aria-label={`Agent activity: ${label}`}
        aria-controls={contentId}
        aria-expanded={expanded}
        className="agent-activity__header"
        variant="ghost"
        onClick={(event) => {
          setAnimateDisclosure(event.detail > 0)
          setExpanded((current) => !current)
        }}
      >
        {isLive ? (
          <span aria-hidden="true" className="agent-activity__live-dot" />
        ) : (
          <OutcomeIcon
            aria-hidden="true"
            className={
              failed ? 'agent-activity__step-icon text-destructive' : 'agent-activity__step-icon'
            }
          />
        )}
        <span className="agent-activity__heading" title={label}>
          {label}
        </span>
        <ChevronDownIcon aria-hidden="true" className="agent-activity__group-chevron size-3.5" />
      </Button>
      <span className="sr-only" role="status">
        {label}
      </span>
      <div className="agent-activity__body" id={contentId}>
        <div
          aria-hidden={!expanded}
          className="agent-activity__body-inner"
          inert={!expanded}
          role="list"
        >
          {parts.map((part, index) => (
            <div
              className="agent-activity__item"
              key={part.type === 'dynamic-tool' ? part.toolCallId : `${id}-${index}`}
              role="listitem"
            >
              {part.type === 'reasoning' ? (
                <ThinkingTrace
                  id={`${id}-${index}`}
                  isStreaming={isLive && part.state === 'streaming'}
                  text={part.text}
                />
              ) : (
                <ToolTrace isActive={isLive} part={part} />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const ThinkingBlock = ThinkingTrace
export {
  AgentLoadingIndicator,
  AgentActivityTimeline,
  ThinkingBlock,
  ToolTrace,
  type ToolOutputDelta,
  type AgentActivityPart
}
