import { Button } from '@mico/ui'
import { ChevronDownIcon } from 'lucide-react'
import * as React from 'react'

import {
  ToolNode,
  ToolTrace,
  firstErrorLine,
  getToolActivityState,
  type ToolActivityPart,
  type ToolNodeState
} from './tool-trace'

/**
 * Consecutive read calls collapse into one group line, like Claude Code's
 * collapsed read groups: `Read N files`, with individual paths and results
 * available after expanding the group.
 */
function ToolTraceGroup({
  isLive = true,
  parts
}: {
  isLive?: boolean
  parts: ToolActivityPart[]
}): React.JSX.Element {
  const [isExpanded, setExpanded] = React.useState(false)
  const [animateDisclosure, setAnimateDisclosure] = React.useState(false)
  const states = parts.map((part) => getToolActivityState(part, isLive))
  const isRunning = states.some((state) =>
    ['executing', 'preparing', 'streaming-output'].includes(state)
  )
  const hasError = states.includes('failed')
  const incomplete = states.filter((state) => state === 'incomplete').length
  const failed = states.filter((state) => state === 'failed').length
  const nodeState: ToolNodeState = hasError
    ? 'error'
    : isRunning
      ? 'running'
      : incomplete
        ? 'incomplete'
        : 'success'
  const fileCount = `${parts.length} ${parts.length === 1 ? 'file' : 'files'}`
  const label = isRunning
    ? `Reading ${fileCount}…`
    : failed || incomplete
      ? [
          `${parts.length} ${parts.length === 1 ? 'file read' : 'file reads'}`,
          failed ? `${failed} failed` : null,
          incomplete ? `${incomplete} not completed` : null
        ]
          .filter(Boolean)
          .join(' · ')
      : `Read ${fileCount}`
  const firstFailure = parts.find((part) => getToolActivityState(part, isLive) === 'failed')
  const contentId = `tool-trace-group-${parts[0]?.toolCallId ?? '0'}`

  return (
    <section
      className="thinking-block agent-activity__trace w-full min-w-0 text-sm"
      data-open={isExpanded}
      data-animate-disclosure={animateDisclosure}
    >
      <Button
        aria-controls={contentId}
        aria-expanded={isExpanded}
        aria-label={label}
        className="agent-activity__trigger hover:bg-transparent hover:text-text-secondary aria-expanded:bg-transparent aria-expanded:text-text-secondary"
        variant="ghost"
        onClick={(event) => {
          setAnimateDisclosure(event.detail > 0)
          setExpanded((current) => !current)
        }}
      >
        <ToolNode state={nodeState} toolName="Read" />
        <span className="agent-activity__action">{label}</span>
        <span aria-hidden="true" className="thinking-block__chevron">
          <ChevronDownIcon className="size-3.5" />
        </span>
      </Button>
      {firstFailure ? (
        <div className="agent-activity__result agent-activity__result--error">
          {firstErrorLine(firstFailure.errorText)}
        </div>
      ) : null}
      <div className="thinking-block__panel">
        <div
          aria-hidden={!isExpanded}
          className="thinking-block__panel-inner"
          id={contentId}
          inert={!isExpanded}
        >
          {parts.map((part) => (
            <ToolTrace isActive={isLive} key={part.toolCallId} part={part} showDetails={false} />
          ))}
        </div>
      </div>
    </section>
  )
}

export { ToolTraceGroup }
