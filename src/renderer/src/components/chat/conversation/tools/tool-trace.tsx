import { Button } from '@mico/ui'
import type { ToolPermissionData } from '@shared/ai/permissions'
import { getToolPresentation, toolLabel } from '@shared/ai/tool-presentation'
import {
  getToolTracePresentation,
  type ToolTraceInput,
  ToolTraceInputSchema
} from '@shared/ai/tool-trace'
import type { DynamicToolUIPart } from 'ai'
import {
  BookOpenIcon,
  ChevronDownIcon,
  FilePenLineIcon,
  FilePlus2Icon,
  FileSearchIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon
} from 'lucide-react'
import * as React from 'react'
import * as z from 'zod'
import { editPreview } from './edit-preview'
import {
  formatGenericToolPayload,
  GenericToolPayloadValueSchema,
  GenericToolTrace
} from './generic-tool-trace'
import { stripTerminalControlSequences } from './terminal-output'
import { ToolPermissionCard } from './tool-permission-card'
import { ToolTracePresentationView } from './tool-trace-renderers'

type ToolDescription = {
  accessibleDetail?: string
  detail: string | null
  fullDetail?: string
  title: string
}
type ToolOutputDelta = { preview: string; stderr: string; stdout: string }
type ToolActivityPart = DynamicToolUIPart & {
  liveOutput?: ToolOutputDelta
  permission?: ToolPermissionData
}
type ToolActivityState =
  | 'incomplete'
  | 'completed'
  | 'executing'
  | 'failed'
  | 'preparing'
  | 'streaming-output'
  | 'awaiting-approval'

// Keep live summaries stable; full streaming output belongs to the disclosure.
const MAX_SUMMARY_CHARACTERS = 2_000
const MAX_COMMAND_CHARACTERS = 120
const COMPACT_OUTPUT_LINES = 5
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
  if (part.permission?.state === 'pending') return 'awaiting-approval'
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
  const line = toLines(stripTerminalControlSequences(errorText ?? '')).find((candidate) =>
    candidate.trim()
  )
  return truncateSummary(line ?? 'Tool execution failed.')
}

type ToolSummary =
  | { detail: string | null; kind: 'failure'; text: string }
  | { kind: 'message'; isError: boolean; text: string }
  | { kind: 'output'; meta: string | null; note: string | null; text: string }

function displayBashCommand(command: string): string {
  const firstLine = command.trim().split('\n')[0] ?? ''
  const withoutDirectory = firstLine.replace(/^cd\s+(?:"[^"]*"|'[^']*'|[^;&|]+)\s*&&\s*/, '')
  return withoutDirectory.length > MAX_COMMAND_CHARACTERS
    ? `${withoutDirectory.slice(0, MAX_COMMAND_CHARACTERS)}…`
    : withoutDirectory
}

function getFailureDetail(part: ToolActivityPart, headline: string): string | null {
  const streamed = part.liveOutput?.stderr || part.liveOutput?.stdout
  const candidates = streamed ? toLines(streamed) : toLines(part.errorText ?? '').slice(1)
  const detail = candidates
    .map(stripTerminalControlSequences)
    .findLast((line) => line.trim())
    ?.trim()
  return detail && detail !== headline ? truncateSummary(detail) : null
}

function compactOutputSummary(text: string): Extract<ToolSummary, { kind: 'output' }> {
  const lines = toLines(stripTerminalControlSequences(text))
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  const visible = lines.slice(-COMPACT_OUTPUT_LINES)
  const hiddenCount = Math.max(0, lines.length - visible.length)
  const visibleText = visible.join('\n')
  const summaryText =
    visibleText.length > MAX_SUMMARY_CHARACTERS
      ? `…${visibleText.slice(-(MAX_SUMMARY_CHARACTERS - 1))}`
      : visibleText
  return {
    kind: 'output',
    meta: null,
    note: hiddenCount > 0 ? `+${countUnits(hiddenCount, 'earlier line')}` : null,
    text: summaryText
  }
}

function displayToolPath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  const isAbsolute = normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)
  const segments = normalized.split('/').filter(Boolean)
  if (!isAbsolute || segments.length <= 3) return normalized
  return `…/${segments.slice(-3).join('/')}`
}

function getRunningSummary(toolName: string, elapsedSeconds: number): string {
  if (toolName === 'Bash' && elapsedSeconds > 0) return `Running ${elapsedSeconds}s…`
  return (
    {
      Bash: 'Running…',
      Edit: 'Applying changes…',

      Glob: 'Searching…',
      Grep: 'Searching…',
      Read: 'Reading file…',
      LoadSkill: 'Loading skill…',
      ReadSkillResource: 'Reading skill resource…',
      Write: 'Writing file…'
    }[toolName] ?? 'Running…'
  )
}

function getToolSummary(
  part: ToolActivityPart,
  state: ToolActivityState,
  input: ToolTraceInput | undefined,
  output: string | undefined,
  presentation: ReturnType<typeof getToolTracePresentation>,
  liveOutput: ToolOutputDelta | undefined,
  elapsedSeconds: number
): ToolSummary {
  if (state === 'failed') {
    const text = firstErrorLine(part.errorText)
    return { detail: getFailureDetail(part, text), kind: 'failure', text }
  }
  if (state === 'preparing') return { kind: 'message', isError: false, text: 'Preparing…' }
  // Approval and interruption read through the row's status word instead of a
  // summary line; ToolTrace never asks for a summary in those states.

  if (state === 'streaming-output' && part.toolName === 'Bash') {
    const combined = [liveOutput?.stdout, liveOutput?.stderr].filter(Boolean).join('\n')
    if (combined)
      return {
        ...compactOutputSummary(combined),
        meta: `${countUnits(countOutputLines(combined), 'line')} · ${elapsedSeconds}s`
      }
  }

  if (state === 'executing' || state === 'streaming-output') {
    return {
      kind: 'message',
      isError: false,
      text: getRunningSummary(part.toolName, elapsedSeconds)
    }
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
    case 'LoadSkill':
    case 'ReadSkillResource':
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
      const target = input?.path ? ` to ${displayToolPath(input.path)}` : ''
      return {
        kind: 'message',
        isError: false,
        text: `Wrote ${countUnits(countLines(content), 'line')}${target}.`
      }
    }
    case 'Bash': {
      const content = presentation?.type === 'bash' ? presentation.content : output
      if (content === undefined) return { kind: 'message', isError: false, text: 'Completed.' }
      if (!content.trim()) return { kind: 'message', isError: false, text: '(No output)' }
      return compactOutputSummary(content)
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
        ? {
            title: toolLabel(toolName),
            detail: displayBashCommand(input.command),
            fullDetail: input.command
          }
        : { title: 'Bash command', detail: null }
    case 'Edit':
    case 'Read':
    case 'Write':
    case 'LoadSkill':
    case 'ReadSkillResource':
      return input.path
        ? {
            title: toolLabel(toolName),
            accessibleDetail: input.path,
            detail: displayToolPath(input.path),
            fullDetail: input.path
          }
        : { title: `${toolLabel(toolName)} file`, detail: null }
    default:
      return { title: toolLabel(toolName), detail: null }
  }
}

type ToolNodeState = 'error' | 'incomplete' | 'running' | 'success'

function getToolNodeState(state: ToolActivityState): ToolNodeState {
  if (state === 'awaiting-approval') return 'incomplete'
  if (state === 'failed') return 'error'
  if (state === 'completed') return 'success'
  // An interrupted call must neither claim success nor pulse like it is still running.
  if (state === 'incomplete') return 'incomplete'
  return 'running'
}

/**
 * The row's own word for the three states a node color cannot say alone:
 * failure, approval, and interruption. Every other state reads through the
 * action, the target, and the summary line.
 */
function getToolStateWord(state: ToolActivityState): string | null {
  if (state === 'failed') return 'Failed'
  if (state === 'awaiting-approval') return 'Awaiting approval'
  if (state === 'incomplete') return 'Interrupted'
  return null
}

/** Bash rows speak in past-tense verbs instead of the generic state words. */
function getBashActionVerb(state: ToolActivityState): string {
  switch (state) {
    case 'completed':
      return 'Ran'
    case 'awaiting-approval':
      return 'Awaiting approval'
    case 'preparing':
      return 'Preparing'
    case 'failed':
      return 'Failed to run'
    case 'incomplete':
      return 'Interrupted'
    default:
      return 'Running'
  }
}

function ToolIcon({ toolName }: { toolName: string }): React.JSX.Element {
  const Icon = {
    command: TerminalIcon,
    edit: FilePenLineIcon,
    search: SearchIcon,
    read: FileSearchIcon,
    skill: BookOpenIcon,
    write: FilePlus2Icon,
    tool: WrenchIcon
  }[getToolPresentation(toolName).iconKind]
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
  if (summary.kind === 'failure') {
    return (
      <div className="agent-activity__result agent-activity__result--error">
        <div>{summary.text}</div>
        {summary.detail ? (
          <div className="agent-activity__error-detail font-mono">{summary.detail}</div>
        ) : null}
      </div>
    )
  }
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
      {summary.note ? <div className="agent-activity__result-note">{summary.note}</div> : null}
      {summary.meta ? <div className="agent-activity__result-meta">{summary.meta}</div> : null}
    </div>
  )
}

function useElapsedSeconds(active: boolean): number {
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0)

  React.useEffect(() => {
    if (!active) return
    const startedAt = Date.now()
    const intervalId = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000))
    }, 1_000)
    return () => window.clearInterval(intervalId)
  }, [active])

  return active ? elapsedSeconds : 0
}

/** A timeline summary uses the same validated input as the tool row. */
function getToolActivityLabel(part: ToolActivityPart): string {
  const input = ToolTraceInputSchema.safeParse(part.input)
  const action = getToolPresentation(part.toolName).activityLabel
  const target = input.success ? describeTool(part.toolName, input.data).detail : null
  return [action, target].filter(Boolean).join(' ')
}

/** Compact invocation with opt-in details; failures remain visible for recovery. */
function ToolTrace({
  part,
  isActive = true
}: {
  part: ToolActivityPart
  isActive?: boolean
}): React.JSX.Element {
  // Disclosure is derived with a manual override: a failed trace opens by
  // default, the user's own toggle always wins, and streaming updates never
  // reset the choice. Rows stay mounted (the transcript is not virtualized),
  // so local state is the whole owner — no cross-render cache.
  const [userExpanded, setUserExpanded] = React.useState<boolean | null>(null)
  const [hasOpened, setHasOpened] = React.useState(false)
  const [animateDisclosure, setAnimateDisclosure] = React.useState(false)
  const activityState = getToolActivityState(part, isActive)
  const isFailed = activityState === 'failed'
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
  const genericInput = GenericToolPayloadValueSchema.safeParse(part.input)
  const genericOutput = GenericToolPayloadValueSchema.safeParse(
    'output' in part ? part.output : part.errorText
  )
  const genericDetails =
    presentation == null && !getToolPresentation(part.toolName).known
      ? {
          input: formatGenericToolPayload(genericInput.success ? genericInput.data : undefined),
          output: formatGenericToolPayload(genericOutput.success ? genericOutput.data : undefined)
        }
      : null
  const isRunning = nodeState === 'running'
  const elapsedSeconds = useElapsedSeconds(isRunning && part.toolName === 'Bash')
  // The bare status words cover the whole summary for approval and interruption;
  // repeating both would make a screen reader announce the same state twice.
  const isStateWordSummary = activityState === 'awaiting-approval' || activityState === 'incomplete'
  const summary: ToolSummary | null = isStateWordSummary
    ? null
    : getToolSummary(
        part,
        activityState,
        input.success ? input.data : undefined,
        output?.success ? output.data : undefined,
        presentation,
        part.liveOutput,
        elapsedSeconds
      )
  // Failed mutations must not render their proposed edits as successfully applied.
  const isFileTool = ['Read', 'Edit', 'Write', 'LoadSkill', 'ReadSkillResource'].includes(
    part.toolName
  )
  const hasPanel =
    (presentation != null &&
      (activityState !== 'failed' || part.toolName === 'Bash') &&
      (!isFileTool || activityState === 'completed')) ||
    genericDetails != null
  const contentId = `tool-trace-${part.toolCallId}`
  const stateWord =
    part.toolName === 'Bash' ? getBashActionVerb(activityState) : getToolStateWord(activityState)
  const accessibleSummary =
    summary == null
      ? null
      : summary.kind === 'output'
        ? activityState === 'completed'
          ? 'Output available'
          : 'Live output'
        : [summary.text, summary.kind === 'failure' ? summary.detail : null]
            .filter(Boolean)
            .join(' · ')
  // The name carries the state word wherever the summary line no longer does:
  // non-Bash rows state it as a new word, Bash rows only when the bare status
  // summary was dropped (approval, interruption); otherwise the names keep
  // their established shape.
  const accessibleStateWord =
    stateWord && (part.toolName !== 'Bash' || isStateWordSummary) ? stateWord : null
  const accessibleName = [
    tool.title,
    tool.accessibleDetail ?? tool.detail,
    accessibleStateWord,
    accessibleSummary
  ]
    .filter(Boolean)
    .join(' ')
  const isExpanded = userExpanded ?? (isFailed && hasPanel)
  const header = (
    <>
      <ToolNode state={nodeState} toolName={part.toolName} />
      <span className="agent-activity__action">
        {part.toolName === 'Bash' ? getBashActionVerb(activityState) : tool.title}
      </span>
      {tool.detail ? (
        <span className="agent-activity__summary font-mono" title={tool.fullDetail ?? tool.detail}>
          ({tool.detail})
        </span>
      ) : null}
      {part.toolName !== 'Bash' && stateWord ? (
        <span className="agent-activity__state" data-state={activityState}>
          {stateWord}
        </span>
      ) : null}
      {isRunning && elapsedSeconds > 0 ? (
        <span aria-hidden="true" className="text-xs text-text-tertiary">
          {elapsedSeconds}s
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
            setHasOpened(true)
            setUserExpanded(!isExpanded)
          }}
        >
          {header}
        </Button>
      ) : (
        <div aria-label={accessibleName} className="agent-activity__trigger" role="group">
          {header}
        </div>
      )}
      {summary &&
        (activityState === 'failed' ||
          (!isExpanded && part.toolName !== 'Bash' && !isStateWordSummary)) && (
          <ToolSummaryLine summary={summary} />
        )}
      {part.permission && (part.permission.state !== 'pending' || !isActive) && (
        <ToolPermissionCard
          permission={part.permission}
          isActive={isActive}
          onRespond={(response) => window.api.chat.respondToPermission(response)}
        />
      )}
      {hasPanel ? (
        <div className="thinking-block__panel">
          <div
            aria-hidden={!isExpanded}
            className="thinking-block__panel-inner text-xs"
            id={contentId}
            inert={!isExpanded}
          >
            {presentation != null
              ? (hasOpened || isExpanded) && (
                  <ToolTracePresentationView
                    command={input.success ? input.data.command : undefined}
                    isDraft={activityState !== 'completed'}
                    isStreaming={isRunning}
                    liveOutput={part.liveOutput}
                    path={input.success ? input.data.path : undefined}
                    presentation={presentation}
                  />
                )
              : genericDetails && (
                  <GenericToolTrace input={genericDetails.input} output={genericDetails.output} />
                )}
          </div>
        </div>
      ) : null}
    </section>
  )
}

export {
  firstErrorLine,
  getToolActivityLabel,
  getToolActivityState,
  type ToolActivityPart,
  ToolNode,
  type ToolNodeState,
  type ToolOutputDelta,
  ToolTrace
}
