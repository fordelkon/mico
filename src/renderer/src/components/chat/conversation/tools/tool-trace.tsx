import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@mico/ui'
import {
  ChevronDownIcon,
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
type ToolActivityState = 'completed' | 'executing' | 'failed' | 'preparing' | 'streaming-output'

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

function getToolActivityState(part: ToolActivityPart): ToolActivityState {
  if (part.state === 'output-error') return 'failed'
  if (part.state === 'input-streaming') return 'preparing'
  if (part.state === 'input-available') {
    if (part.toolName === 'bash' && (part.liveOutput?.stdout || part.liveOutput?.stderr))
      return 'streaming-output'
    return 'executing'
  }
  return 'completed'
}

function getToolStatus(
  toolName: string,
  state: ToolActivityState,
  output: string | undefined
): string {
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

/** The shared disclosure shell delegates content to the tool-specific trace renderer. */
function ToolTrace({
  part,
  isFollowedByActivity = false
}: {
  part: ToolActivityPart
  isFollowedByActivity?: boolean
}): React.JSX.Element {
  const [expanded, setExpanded] = React.useState(
    part.state === 'input-available' || part.state === 'input-streaming'
  )
  const [hasUserToggled, setHasUserToggled] = React.useState(false)
  const [isFollowingOutput, setIsFollowingOutput] = React.useState(true)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const wasRunning = React.useRef(false)
  const activityState = getToolActivityState(part)
  const isError = activityState === 'failed'
  const isRunning = activityState !== 'completed' && !isError
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
  const detail = isError
    ? part.errorText
    : output?.success
      ? describeOutput(part.toolName, output.data)
      : isRunning
        ? null
        : 'No output was returned.'
  const liveOutput = part.liveOutput
  const presentation = getToolTracePresentation(
    part.toolName,
    input.success ? input.data : undefined,
    output?.success ? output.data : liveOutput && part.toolName === 'bash' ? '' : undefined
  )
  const contentId = `tool-trace-${part.toolCallId}`
  const isExpanded = hasUserToggled ? expanded : isRunning || (!isFollowedByActivity && expanded)
  const hasDetail = Boolean(tool.detail || detail || presentation || liveOutput)

  React.useEffect(() => {
    // A completed tool should return to its compact trace row. The detail panel
    // remains available on demand, while active tools stay open at the live edge.
    if (wasRunning.current && !isRunning && !hasUserToggled) setExpanded(false)
    wasRunning.current = isRunning
  }, [hasUserToggled, isRunning])

  React.useEffect(() => {
    if (!isRunning || !isExpanded || !isFollowingOutput) return
    const frameId = window.requestAnimationFrame(() => {
      const panel = panelRef.current
      if (panel) panel.scrollTo({ top: panel.scrollHeight, behavior: 'auto' })
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [detail, isExpanded, isFollowingOutput, isRunning, liveOutput])

  const handlePanelScroll = (): void => {
    const panel = panelRef.current
    if (panel) setIsFollowingOutput(panel.scrollHeight - panel.scrollTop - panel.clientHeight < 12)
  }

  const followLatestOutput = (): void => {
    const panel = panelRef.current
    if (!panel) return
    panel.scrollTo({ top: panel.scrollHeight, behavior: 'auto' })
    setIsFollowingOutput(true)
  }

  return (
    <section
      className="thinking-block agent-activity__trace w-full min-w-0 text-sm text-text-tertiary"
      data-open={isExpanded}
    >
      <TooltipProvider delayDuration={500}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={[tool.title, tool.detail, status].filter(Boolean).join(' ')}
              aria-controls={hasDetail ? contentId : undefined}
              aria-expanded={hasDetail ? isExpanded : undefined}
              className="agent-activity__trigger h-7 w-full min-w-0 gap-2 px-1 text-text-tertiary hover:bg-surface-secondary hover:text-foreground"
              variant="ghost"
              onClick={() => {
                if (!hasDetail) return
                setHasUserToggled(true)
                setExpanded(!isExpanded)
              }}
            >
              <ToolIcon toolName={part.toolName} />
              <span className="shrink-0 font-medium text-foreground">{tool.title}</span>
              {tool.detail ? (
                <span className="agent-activity__summary font-mono" title={tool.detail}>
                  {tool.detail}
                </span>
              ) : null}
              <span
                className={
                  isError
                    ? 'shrink-0 text-destructive'
                    : isRunning
                      ? 'thinking-block__label thinking-block__label--active shrink-0'
                      : 'shrink-0 text-text-tertiary'
                }
              >
                {status}
              </span>
              <span aria-hidden="true" className="thinking-block__chevron">
                <ChevronDownIcon className="size-3.5" />
              </span>
            </Button>
          </TooltipTrigger>
          {input.success && input.data.command ? (
            <TooltipContent className="max-w-sm break-all font-mono text-xs">
              {input.data.command}
            </TooltipContent>
          ) : null}
        </Tooltip>
      </TooltipProvider>
      {hasDetail ? (
        <div className="thinking-block__panel">
          <div
            aria-hidden={!isExpanded}
            className={`thinking-block__panel-inner whitespace-pre-wrap break-words font-mono text-xs${
              isRunning && isExpanded ? ' thinking-block__panel-inner--streaming' : ''
            }`}
            id={contentId}
            onScroll={handlePanelScroll}
            ref={panelRef}
          >
            {presentation ? (
              <ToolTracePresentationView
                command={input.success ? input.data.command : undefined}
                isDraft={isRunning}
                isStreaming={isRunning}
                liveOutput={liveOutput}
                path={input.success ? input.data.path : undefined}
                presentation={presentation}
              />
            ) : (
              <>
                {tool.detail ? <div className="text-text-tertiary">{tool.detail}</div> : null}
                {activityState === 'executing' ? (
                  <div className="mt-2 border-t border-border pt-2 text-text-secondary">
                    {status}…
                  </div>
                ) : null}
                {detail ? <div className="mt-2 border-t border-border pt-2">{detail}</div> : null}
              </>
            )}
            {isRunning && !isFollowingOutput ? (
              <button
                className="tool-trace__jump-to-latest"
                type="button"
                onClick={followLatestOutput}
              >
                Jump to latest
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

export { ToolTrace, type ToolActivityPart, type ToolOutputDelta }
