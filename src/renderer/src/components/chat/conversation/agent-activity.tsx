import type { ReasoningUIPart } from 'ai'
import * as React from 'react'
import { toolLabel } from '@shared/ai/tool-presentation'

import { ThinkingTrace } from './tools/thinking-trace'
import { ToolTraceGroup } from './tools/trace-group'
import {
  getToolActivityState,
  getToolActivityLabel,
  ToolTrace,
  type ToolActivityPart,
  type ToolOutputDelta
} from './tools/tool-trace'

type AgentActivityPart = ReasoningUIPart | ToolActivityPart

// Consecutive read calls collapse into one group line; any other part breaks the
// group, matching Claude Code's read-group collapsing.
type TimelineSegment =
  | { kind: 'group'; parts: ToolActivityPart[] }
  | { kind: 'reasoning-group'; parts: ReasoningUIPart[] }
  | { kind: 'single'; part: AgentActivityPart }

function completedToolSummary(tools: ToolActivityPart[]): string {
  const summaries = new Map<string, { count: number; unit: string; verb: string }>()
  for (const tool of tools) {
    const definition = {
      Bash: { key: 'bash', unit: 'command', verb: 'Ran' },
      Edit: { key: 'edit', unit: 'file', verb: 'Updated' },
      Glob: { key: 'search', unit: 'pattern', verb: 'Searched' },
      Grep: { key: 'search', unit: 'pattern', verb: 'Searched' },
      Read: { key: 'read', unit: 'file', verb: 'Read' },
      Write: { key: 'write', unit: 'file', verb: 'Wrote' }
    }[tool.toolName] ?? {
      key: tool.toolName,
      unit: 'call',
      verb: toolLabel(tool.toolName)
    }
    const current = summaries.get(definition.key)
    if (current) current.count += 1
    else summaries.set(definition.key, { count: 1, unit: definition.unit, verb: definition.verb })
  }

  return Array.from(
    summaries.values(),
    ({ count, unit, verb }) => `${verb} ${count} ${unit}${count === 1 ? '' : 's'}`
  ).join(' · ')
}

function toTimelineSegments(parts: AgentActivityPart[]): TimelineSegment[] {
  const segments: TimelineSegment[] = []
  for (const part of parts) {
    if (part.type === 'reasoning' && part.state !== 'streaming') {
      const last = segments.at(-1)
      if (last?.kind === 'reasoning-group') last.parts.push(part)
      else segments.push({ kind: 'reasoning-group', parts: [part] })
    } else if (part.type === 'dynamic-tool' && part.toolName === 'Read') {
      const last = segments.at(-1)
      if (last?.kind === 'group') last.parts.push(part)
      else segments.push({ kind: 'group', parts: [part] })
    } else {
      segments.push({ kind: 'single', part })
    }
  }
  // A lone read keeps its own invocation header; only runs of two or more
  // collapse into a group line.
  return segments.map((segment) =>
    segment.kind === 'group' && segment.parts.length === 1
      ? { kind: 'single', part: segment.parts[0] }
      : segment.kind === 'reasoning-group' && segment.parts.length === 1
        ? { kind: 'single', part: segment.parts[0] }
        : segment
  )
}

function AgentLoadingIndicator({ label = 'Thinking' }: { label?: string }): React.JSX.Element {
  return (
    <section aria-label="Agent activity" className="agent-activity agent-activity--loading">
      <div className="agent-activity__live-status" role="status">
        <span aria-hidden="true" className="agent-activity__live-dot" />
        <span>{label}</span>
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
  const tools = parts.filter((part): part is ToolActivityPart => part.type === 'dynamic-tool')
  const awaitingApproval = isLive && tools.some((part) => part.permission?.state === 'pending')
  const failed = tools.filter((part) => getToolActivityState(part, isLive) === 'failed').length
  const incomplete = tools.filter(
    (part) => getToolActivityState(part, isLive) === 'incomplete'
  ).length
  const active = tools.filter((part) =>
    ['preparing', 'executing', 'streaming-output'].includes(getToolActivityState(part, isLive))
  )
  const completed = tools.filter((part) => getToolActivityState(part, isLive) === 'completed')
  const summary = completed.length
    ? completedToolSummary(completed)
    : tools.length
      ? null
      : 'Reasoning finished'
  const liveLabel = awaitingApproval
    ? 'Waiting for your approval'
    : active.length > 1
      ? `Running ${active.length} tools`
      : active.length === 1
        ? getToolActivityLabel(active[0])
        : parts.some((part) => part.type === 'reasoning' && part.state === 'streaming') ||
            !parts.length
          ? 'Thinking'
          : 'Working'
  const label = [
    isLive ? liveLabel : summary,
    failed ? `${failed} ${failed === 1 ? 'tool' : 'tools'} failed` : null,
    incomplete ? `${incomplete} ${incomplete === 1 ? 'call' : 'calls'} interrupted` : null
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <section
      aria-label="Agent activity"
      className="agent-activity"
      data-live={isLive}
      data-testid="agent-activity-event"
    >
      <span className="sr-only" role="status">
        {label}
      </span>
      <div className="agent-activity__timeline">
        <div className="agent-activity__body-inner" role="list">
          {toTimelineSegments(parts).map((segment, index) => (
            <div
              className="agent-activity__item"
              key={
                segment.kind === 'group'
                  ? `group-${segment.parts[0]?.toolCallId}`
                  : segment.kind === 'reasoning-group'
                    ? `reasoning-group-${id}-${index}`
                    : segment.part.type === 'dynamic-tool'
                      ? segment.part.toolCallId
                      : `${id}-${index}`
              }
              role="listitem"
            >
              {segment.kind === 'group' ? (
                <ToolTraceGroup isLive={isLive} parts={segment.parts} />
              ) : segment.kind === 'reasoning-group' ? (
                <ThinkingTrace
                  excerptText={segment.parts.at(-1)?.text}
                  id={`${id}-${index}`}
                  isStreaming={false}
                  labelOverride={`Reasoning · ${segment.parts.length} steps`}
                  text={segment.parts.map((part) => part.text).join('\n\n')}
                />
              ) : segment.part.type === 'reasoning' ? (
                <ThinkingTrace
                  id={`${id}-${index}`}
                  isStreaming={isLive && segment.part.state === 'streaming'}
                  text={segment.part.text}
                />
              ) : (
                <ToolTrace isActive={isLive} part={segment.part} />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export {
  AgentLoadingIndicator,
  AgentActivityTimeline,
  type ToolOutputDelta,
  type AgentActivityPart
}
