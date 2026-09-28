import { Button } from '@mico/ui'
import {
  ChevronDownIcon,
  FilePenLineIcon,
  FilePlus2Icon,
  FileSearchIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon
} from 'lucide-react'
import type { DynamicToolUIPart } from 'ai'
import * as React from 'react'
import * as z from 'zod'

import { toolLabel } from '@shared/ai/tool-presentation'
import { editPreview } from './edit-preview'

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

// Keep live summaries stable; full streaming output belongs to the disclosure.
const MAX_SUMMARY_CHARACTERS = 2_000
const COMPLETED_OUTPUT_LINES = 3
const ToolOutputSchema = z.union([
  z.string(),
  z.object({ output: z.string() }).transform(({ output }) => output),
  z.object({ stdout: z.string() }).transform(({ stdout }) => stdout),
  z.object({ content: z.string() }).transform(({ content }) => content),
  z.object({ text: z.string() }).transform(({ text }) => text)
])

function getToolActivityState(part: ToolActivityPart, isActive = true): ToolActivityState {
  if (part.state === 'output-error' || part.state === 'output-denied') return 'failed'
  if (part.state === 'output-available') return 'completed'
  if (!isActive) return 'incomplete'
  if (part.state === 'input-streaming') return 'preparing'
  if (part.state === 'input-available') {
    if (part.toolName === 'Bash' && (part.liveOutput?.stdout || part.liveOutput?.stderr))
      return 'streaming-output'
    return 'executing'
  }
  return 'preparing'
}

function truncateSummary(text: string): string {
  return text.length > MAX_SUMMARY_CHARACTERS ? `${text.slice(0, MAX_SUMMARY_CHARACTERS)}…` : text
}

function countLines(text: string): number {
  return text ? text.split('\n').length : 0
}

function countUnits(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`
}

function toLines(text: string): string[] {
  return text.replaceAll('\r', '').split('\n')
}

function countOutputLines(output: string): number {
  // Stored read output can carry a trailing continuation marker; it is not file content.
  return toLines(output).filter(
    (line) => line.trim() && !line.startsWith('[More content available')
  ).length
}

function firstErrorLine(errorText: string | undefined): string {
  const line = toLines(errorText ?? '').find((candidate) => candidate.trim())
  return truncateSummary(line ?? 'Tool execution failed.')
}

type ToolSummary =
  | { kind: 'message'; isError: boolean; text: string }
  | { kind: 'output'; hiddenCount: number; text: string }

function getRunningSummary(toolName: string): string {
  return (
    {
      Bash: 'Running…',
      Edit: 'Applying changes…',

      Glob: 'Searching…',
      Grep: 'Searching…',
      Read: 'Reading file…',
      Write: 'Writing file…'
    }[toolName] ?? 'Running…'
  )
}

function getToolSummary(
  part: ToolActivityPart,
  state: ToolActivityState,
  input: ToolTraceInput | undefined,
  output: string | undefined,
  presentation: ReturnType<typeof getToolTracePresentation>
): ToolSummary {
  if (state === 'failed')
    return { kind: 'message', isError: true, text: firstErrorLine(part.errorText) }
  if (state === 'preparing') return { kind: 'message', isError: false, text: 'Preparing…' }
  if (state === 'incomplete') return { kind: 'message', isError: false, text: 'Not completed.' }

  if (state === 'executing' || state === 'streaming-output') {
    return { kind: 'message', isError: false, text: getRunningSummary(part.toolName) }
  }

  switch (part.toolName) {
    case 'Glob':
    case 'Grep':
      return {
        kind: 'message',
        isError: false,
        text:
          (presentation?.type === 'search' ? presentation.content : output)?.split('\n')[0] ||
          'Search completed.'
      }
    case 'Read':
      return {
        kind: 'message',
        isError: false,
        text: `Read ${countUnits(countOutputLines(presentation?.type === 'read' ? presentation.content : (output ?? '')), 'line')}.`
      }
    case 'Edit': {
      const edits = presentation?.type === 'edit' ? presentation.edits : input?.edits
      if (!edits) return { kind: 'message', isError: false, text: 'Updated file.' }
      const previews = edits.map(editPreview)
      const added = previews.reduce((count, edit) => count + edit.added.length, 0)
      const removed = previews.reduce((count, edit) => count + edit.removed.length, 0)
      return {
        kind: 'message',
        isError: false,
        text: `Added ${countUnits(added, 'line')}, removed ${countUnits(removed, 'line')}.`
      }
    }
    case 'Write': {
      // Restored traces strip input.content for storage; the presentation payload
      // retains it, so fall back before counting zero lines.
      const content = input?.content ?? (presentation?.type === 'write' ? presentation.content : '')
      const target = input?.path ? ` to ${input.path}` : ''
      return {
        kind: 'message',
        isError: false,
        text: `Wrote ${countUnits(countLines(content), 'line')}${target}.`
      }
    }
    case 'Bash': {
      if (output === undefined) return { kind: 'message', isError: false, text: 'Completed.' }
      const lines = toLines(output)
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
      if (!lines.length) return { kind: 'message', isError: false, text: '(No output)' }
      const head = lines.slice(0, COMPLETED_OUTPUT_LINES)
      return {
        kind: 'output',
        hiddenCount: Math.max(0, lines.length - head.length),
        text: truncateSummary(head.join('\n'))
      }
    }
    default:
      return { kind: 'message', isError: false, text: 'Completed.' }
  }
}

function describeTool(toolName: string, input: ToolTraceInput): ToolDescription {
  // The invocation-label convention: ToolName(key input), e.g. Bash(npm test).
  switch (toolName) {
    case 'Glob':
    case 'Grep':
      return {
        title: toolLabel(toolName),
        detail: [input.query, input.path].filter(Boolean).join(' · ') || null
      }
    case 'Bash':
      return input.command
        ? { title: toolLabel(toolName), detail: input.command.split('\n')[0] }
        : { title: 'Bash command', detail: null }
    case 'Edit':
    case 'Read':
    case 'Write':
      return input.path
        ? { title: toolLabel(toolName), detail: input.path }
        : { title: `${toolLabel(toolName)} file`, detail: null }
    default:
      return { title: toolLabel(toolName), detail: null }
  }
}

function getTraceInputPath(part: ToolActivityPart): string | null {
  const input = ToolTraceInputSchema.safeParse(part.input)
  return input.success && input.data.path ? input.data.path : null
}

type ToolNodeState = 'error' | 'incomplete' | 'running' | 'success'

function getToolNodeState(state: ToolActivityState): ToolNodeState {
  if (state === 'failed') return 'error'
  if (state === 'completed') return 'success'
  // An interrupted call must neither claim success nor pulse like it is still running.
  if (state === 'incomplete') return 'incomplete'
  return 'running'
}

function ToolIcon({ toolName }: { toolName: string }): React.JSX.Element {
  const Icon =
    {
      Bash: TerminalIcon,
      Edit: FilePenLineIcon,

      Glob: SearchIcon,
      Grep: SearchIcon,
      Read: FileSearchIcon,
      Write: FilePlus2Icon
    }[toolName] ?? WrenchIcon
  return <Icon aria-hidden="true" className="size-3.5" />
}

/** The row's leading marker: the tool's icon in a node box, tinted by run state. */
function ToolNode({
  state,
  toolName
}: {
  state: ToolNodeState
  toolName: string
}): React.JSX.Element {
  return (
    <span aria-hidden="true" className="agent-activity__node" data-state={state}>
      <ToolIcon toolName={toolName} />
    </span>
  )
}

function ToolSummaryLine({ summary }: { summary: ToolSummary }): React.JSX.Element {
  if (summary.kind === 'message') {
    return (
      <div
        className={
          summary.isError
            ? 'agent-activity__result agent-activity__result--error'
            : 'agent-activity__result'
        }
      >
        {summary.text}
      </div>
    )
  }
  return (
    <div className="agent-activity__result agent-activity__result--output">
      <pre>{summary.text}</pre>
      {summary.hiddenCount > 0 ? (
        <div className="agent-activity__result-note">
          +{countUnits(summary.hiddenCount, 'line')}
        </div>
      ) : null}
    </div>
  )
}

/** A timeline summary uses the same validated input as the tool row. */
function getToolActivityLabel(part: ToolActivityPart): string {
  const input = ToolTraceInputSchema.safeParse(part.input)
  const action = {
    Read: 'Reading',
    Write: 'Writing',
    Edit: 'Updating',

    Glob: 'Searching',
    Grep: 'Searching',
    Bash: 'Running'
  }[part.toolName]
  const target = input.success ? describeTool(part.toolName, input.data).detail : null
  return [action ?? toolLabel(part.toolName), target].filter(Boolean).join(' ')
}

/** The shared trace row: an icon node header with the invocation label, an always
 * visible result line, and an opt-in panel delegating to the tool's renderer. */
function ToolTrace({
  part,
  isActive = true
}: {
  part: ToolActivityPart
  isActive?: boolean
}): React.JSX.Element {
  const [isExpanded, setExpanded] = React.useState(false)
  const [animateDisclosure, setAnimateDisclosure] = React.useState(false)
  const activityState = getToolActivityState(part, isActive)
  const nodeState = getToolNodeState(activityState)
  const input = ToolTraceInputSchema.safeParse(part.input)
  const output = 'output' in part ? ToolOutputSchema.safeParse(part.output) : undefined
  const tool = input.success
    ? describeTool(part.toolName, input.data)
    : { detail: null, title: toolLabel(part.toolName) }
  const presentation = getToolTracePresentation(
    part.toolName,
    input.success ? input.data : undefined,
    output?.success ? output.data : undefined
  )
  const summary = getToolSummary(
    part,
    activityState,
    input.success ? input.data : undefined,
    output?.success ? output.data : undefined,
    presentation
  )
  // Failed mutations must not render their proposed edits as successfully applied.
  const hasPanel = presentation != null && (activityState !== 'failed' || part.toolName === 'Bash')
  const contentId = `tool-trace-${part.toolCallId}`
  const isRunning = nodeState === 'running'
  const accessibleName = [tool.title, tool.detail, summary.text].filter(Boolean).join(' ')

  const header = (
    <>
      <ToolNode state={nodeState} toolName={part.toolName} />
      <span className="agent-activity__action">{tool.title}</span>
      {tool.detail ? (
        <span className="agent-activity__summary font-mono" title={tool.detail}>
          ({tool.detail})
        </span>
      ) : null}
      {hasPanel ? (
        <span aria-hidden="true" className="thinking-block__chevron">
          <ChevronDownIcon className="size-3.5" />
        </span>
      ) : null}
    </>
  )

  return (
    <section
      className="thinking-block agent-activity__trace w-full min-w-0 text-sm text-text-tertiary"
      data-open={isExpanded}
      data-animate-disclosure={animateDisclosure}
      data-state={activityState}
    >
      {hasPanel ? (
        <Button
          aria-label={accessibleName}
          aria-controls={contentId}
          aria-expanded={isExpanded}
          className="agent-activity__trigger hover:bg-transparent hover:text-text-secondary aria-expanded:bg-transparent aria-expanded:text-text-secondary"
          variant="ghost"
          onClick={(event) => {
            setAnimateDisclosure(event.detail > 0)
            setExpanded((current) => !current)
          }}
        >
          {header}
        </Button>
      ) : (
        <div className="agent-activity__trigger">{header}</div>
      )}
      {(!isExpanded || activityState === 'failed' || activityState === 'incomplete') && (
        <ToolSummaryLine summary={summary} />
      )}
      {hasPanel ? (
        <div className="thinking-block__panel">
          <div
            aria-hidden={!isExpanded}
            className="thinking-block__panel-inner text-xs"
            id={contentId}
            inert={!isExpanded}
          >
            <ToolTracePresentationView
              command={input.success ? input.data.command : undefined}
              isDraft={activityState !== 'completed'}
              isPreparing={activityState === 'preparing'}
              isStreaming={isRunning}
              liveOutput={part.liveOutput}
              path={input.success ? input.data.path : undefined}
              presentation={presentation}
            />
          </div>
        </div>
      ) : null}
    </section>
  )
}

export {
  ToolNode,
  ToolTrace,
  firstErrorLine,
  getToolActivityLabel,
  getToolActivityState,
  getTraceInputPath,
  type ToolActivityPart,
  type ToolNodeState,
  type ToolOutputDelta
}
