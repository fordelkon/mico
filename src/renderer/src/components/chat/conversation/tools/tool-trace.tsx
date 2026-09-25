import { Button } from '@mico/ui'
import {
  ChevronDownIcon,
  CircleAlertIcon,
  FilePenLineIcon,
  FilePlus2Icon,
  FileSearchIcon,
  TerminalIcon,
  WrenchIcon
} from 'lucide-react'
import type { DynamicToolUIPart } from 'ai'
import * as React from 'react'
import * as z from 'zod'

import { toolLabel } from '@shared/ai/tool-presentation'

import {
  getToolTracePresentation,
  ToolTraceInputSchema,
  ToolTracePresentationView,
  type ToolTraceInput
} from './tool-trace-renderers'

type ToolDescription = { detail: string | null; title: string }
type ToolOutputDelta = { preview: string; stderr: string; stdout: string }
type ToolActivityPart = DynamicToolUIPart & { liveOutput?: ToolOutputDelta }
type ToolActivityState =
  | 'incomplete'
  | 'completed'
  | 'executing'
  | 'failed'
  | 'preparing'
  | 'streaming-output'

const MAX_TOOL_DISPLAY_CHARACTERS = 2_000
const MAX_TOOL_OUTPUT_LINES = 8
const ToolOutputSchema = z.union([
  z.string(),
  z.object({ output: z.string() }).transform(({ output }) => output),
  z.object({ stdout: z.string() }).transform(({ stdout }) => stdout),
  z.object({ content: z.string() }).transform(({ content }) => content),
  z.object({ text: z.string() }).transform(({ text }) => text)
])

function truncateDisplay(text: string): string {
  return text.length > MAX_TOOL_DISPLAY_CHARACTERS
    ? `${text.slice(0, MAX_TOOL_DISPLAY_CHARACTERS)}\n\n[Output truncated.]`
    : text
}

function describeTool(toolName: string, input: ToolTraceInput): ToolDescription {
  switch (toolName) {
    case 'read':
      return input.path
        ? { title: 'Read', detail: input.path }
        : { title: 'Read file', detail: null }
    case 'write':
      return input.path
        ? { title: 'Write', detail: input.path }
        : { title: 'Write file', detail: null }
    case 'edit':
      return input.path
        ? { title: input.edits ? `Edit ${input.edits.length} changes` : 'Edit', detail: input.path }
        : { title: 'Edit file', detail: null }
    case 'bash':
      return input.command
        ? { title: 'Run', detail: input.command.split('\n')[0] }
        : { title: 'Run command', detail: null }
    default:
      return { title: toolLabel(toolName), detail: null }
  }
}

function describeOutput(toolName: string, output: string): string {
  if (toolName === 'read') {
    const lineCount = output.split('\n').filter((line) => !line.startsWith('[More content')).length
    return `Read ${lineCount} ${lineCount === 1 ? 'line' : 'lines'}.`
  }
  const lines = output
    .replaceAll('\r', '')
    .split('\n')
    .filter((line) => line.trim())
    .slice(0, MAX_TOOL_OUTPUT_LINES)
  const display = truncateDisplay(lines.join('\n'))
  return lines.length === MAX_TOOL_OUTPUT_LINES && output.split('\n').length > lines.length
    ? `${display}\n[More output omitted.]`
    : display
}

function getToolActivityState(part: ToolActivityPart, isActive = true): ToolActivityState {
  if (part.state === 'output-error' || part.state === 'output-denied') return 'failed'
  if (part.state === 'output-available') return 'completed'
  if (!isActive) return 'incomplete'
  if (part.state === 'input-streaming') return 'preparing'
  if (part.state === 'input-available') {
    if (part.toolName === 'bash' && (part.liveOutput?.stdout || part.liveOutput?.stderr))
      return 'streaming-output'
    return 'executing'
  }
  return 'preparing'
}

function getToolStatus(
  toolName: string,
  state: ToolActivityState,
  output: string | undefined
): string {
  if (state === 'incomplete') return 'Not completed'
  if (state === 'failed') return 'Failed'
  if (state === 'preparing') return 'Preparing'
  if (state === 'streaming-output') return 'Streaming output'
  if (state === 'executing')
    return (
      { edit: 'Applying changes', read: 'Reading file', write: 'Writing file' }[toolName] ??
      'Running'
    )
  if (toolName === 'write' && output?.startsWith('Created ')) return 'Created'
  if (toolName === 'write' && output?.startsWith('Replaced ')) return 'Replaced'
  if (toolName === 'edit') return 'Updated'
  if (toolName === 'read') return 'Read'
  return 'Completed'
}

function ToolIcon({ toolName }: { toolName: string }): React.JSX.Element {
  const Icon =
    { bash: TerminalIcon, edit: FilePenLineIcon, read: FileSearchIcon, write: FilePlus2Icon }[
      toolName
    ] ?? WrenchIcon
  return <Icon aria-hidden="true" className="size-3.5" />
}

/** A timeline summary uses the same validated input as the tool row. */
function getToolActivityLabel(part: ToolActivityPart): string {
  const input = ToolTraceInputSchema.safeParse(part.input)
  const action = { read: 'Reading', write: 'Writing', edit: 'Editing', bash: 'Running' }[
    part.toolName
  ]
  const target = input.success ? describeTool(part.toolName, input.data).detail : null
  return [action ?? toolLabel(part.toolName), target].filter(Boolean).join(' ')
}

/** Tool details stay under user control throughout their execution lifecycle. */
function ToolTrace({
  part,
  isActive = true
}: {
  part: ToolActivityPart
  isActive?: boolean
}): React.JSX.Element {
  const [expanded, setExpanded] = React.useState(false)
  const [animateDisclosure, setAnimateDisclosure] = React.useState(false)
  const activityState = getToolActivityState(part, isActive)
  const isError = activityState === 'failed'
  const isRunning = ['preparing', 'executing', 'streaming-output'].includes(activityState)
  const input = ToolTraceInputSchema.safeParse(part.input)
  const output = 'output' in part ? ToolOutputSchema.safeParse(part.output) : undefined
  const status = getToolStatus(
    part.toolName,
    activityState,
    output?.success ? output.data : undefined
  )
  const tool = input.success
    ? describeTool(part.toolName, input.data)
    : { detail: null, title: toolLabel(part.toolName) }
  const error = isError
    ? part.errorText ||
      (part.state === 'output-denied'
        ? 'Tool execution was denied. Review the request before trying again.'
        : 'The tool failed. Review its input and try again.')
    : null
  const detail = output?.success
    ? describeOutput(part.toolName, output.data)
    : isRunning || error
      ? null
      : 'No output was returned.'
  const presentation = getToolTracePresentation(
    part.toolName,
    input.success ? input.data : undefined,
    output?.success ? output.data : part.liveOutput && part.toolName === 'bash' ? '' : undefined
  )
  // Failed mutations must not render their proposed edits as successfully applied.
  const showPresentation = presentation && (!isError || part.toolName === 'bash')
  const hasDetail = Boolean(error || tool.detail || detail || showPresentation || part.liveOutput)
  const Trigger = hasDetail ? Button : 'div'
  const contentId = `tool-trace-${part.toolCallId}`

  return (
    <section
      className="thinking-block agent-activity__trace w-full min-w-0 text-sm text-text-tertiary"
      data-open={expanded}
      data-animate-disclosure={animateDisclosure}
      data-state={activityState}
    >
      <Trigger
        aria-label={[tool.title, tool.detail, status].filter(Boolean).join(' ')}
        aria-controls={
          hasDetail
            ? [contentId, error ? `${contentId}-error` : null].filter(Boolean).join(' ')
            : undefined
        }
        aria-expanded={hasDetail ? expanded : undefined}
        className="agent-activity__trigger"
        {...(hasDetail ? { variant: 'ghost' as const } : {})}
        onClick={(event) => {
          if (!hasDetail) return
          setAnimateDisclosure(event.detail > 0)
          setExpanded((current) => !current)
        }}
      >
        <span className="agent-activity__node">
          <ToolIcon toolName={part.toolName} />
        </span>
        <span className="agent-activity__action">{tool.title}</span>
        <span className="agent-activity__summary font-mono" title={tool.detail ?? undefined}>
          {tool.detail}
        </span>
        <span
          className={isError ? 'agent-activity__state text-destructive' : 'agent-activity__state'}
        >
          {status}
        </span>
        {hasDetail ? (
          <span aria-hidden="true" className="thinking-block__chevron">
            <ChevronDownIcon className="size-3.5" />
          </span>
        ) : null}
      </Trigger>
      {error ? (
        <div className="agent-activity__error" id={`${contentId}-error`}>
          <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      {hasDetail ? (
        <div className="thinking-block__panel">
          <div
            aria-hidden={!expanded}
            className="thinking-block__panel-inner whitespace-pre-wrap text-xs"
            id={contentId}
            inert={!expanded}
          >
            <div className="agent-activity__detail">
              {showPresentation ? (
                <ToolTracePresentationView
                  command={input.success ? input.data.command : undefined}
                  isDraft={activityState !== 'completed'}
                  isStreaming={isRunning}
                  liveOutput={part.liveOutput}
                  path={input.success ? input.data.path : undefined}
                  presentation={presentation}
                />
              ) : (
                <>
                  {tool.detail ? (
                    <div className="break-all font-mono text-text-secondary">{tool.detail}</div>
                  ) : null}
                  {detail ? <div className="mt-2 font-mono">{detail}</div> : null}
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export {
  ToolTrace,
  getToolActivityState,
  getToolActivityLabel,
  type ToolActivityPart,
  type ToolOutputDelta
}
