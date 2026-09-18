import {
  Button,
  IconSwap,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@mico/ui'
import {
  BrainIcon,
  ChevronDownIcon,
  FilePenLineIcon,
  FilePlus2Icon,
  FileSearchIcon,
  TerminalIcon,
  WrenchIcon
} from 'lucide-react'
import * as React from 'react'
import { ThinkingOrb } from 'thinking-orbs'
import type { DynamicToolUIPart } from 'ai'
import * as z from 'zod'

const thinkingOrbStates = ['working', 'searching', 'solving'] as const

type ThinkingOrbState = (typeof thinkingOrbStates)[number]

type ThinkingBlockProps = {
  id: string
  isAnswerStreaming?: boolean
  isStreaming: boolean
  orbState?: ThinkingOrbState
  text: string
}
type ToolDescription = { detail: string | null; title: string }

const MAX_TOOL_DISPLAY_CHARACTERS = 2_000
const MAX_TOOL_OUTPUT_LINES = 8
const TOOL_OUTPUT_REVEAL_INTERVAL_MS = 48
const ToolInputSchema = z.object({
  command: z
    .string()
    .max(64 * 1024)
    .optional(),
  edits: z.array(z.object({ newText: z.string(), oldText: z.string() })).optional(),
  path: z.string().max(4_096).optional()
})
const ToolOutputSchema = z.union([
  z.string(),
  z.object({ output: z.string() }).transform(({ output }) => output),
  z.object({ stdout: z.string() }).transform(({ stdout }) => stdout),
  z.object({ content: z.string() }).transform(({ content }) => content),
  z.object({ text: z.string() }).transform(({ text }) => text)
])
type ToolInput = z.infer<typeof ToolInputSchema>

function toolLabel(toolName: string): string {
  return { bash: 'Run', edit: 'Edit', read: 'Read', write: 'Write' }[toolName] ?? toolName
}

function truncateDisplay(text: string): string {
  return text.length > MAX_TOOL_DISPLAY_CHARACTERS
    ? `${text.slice(0, MAX_TOOL_DISPLAY_CHARACTERS)}\n\n[Output truncated.]`
    : text
}

function describeTool(toolName: string, input: ToolInput): ToolDescription {
  switch (toolName) {
    case 'read':
      return input.path
        ? { title: `Read ${input.path}`, detail: `File: ${input.path}` }
        : { title: 'Read file', detail: null }
    case 'write':
      return input.path
        ? { title: `Write ${input.path}`, detail: `File: ${input.path}` }
        : { title: 'Write file', detail: null }
    case 'edit':
      return input.path
        ? {
            title: `Edit ${input.path}${input.edits ? ` · ${input.edits.length} changes` : ''}`,
            detail: `File: ${input.path}`
          }
        : { title: 'Edit file', detail: null }
    case 'bash':
      return input.command
        ? { title: `Run ${input.command.split('\n')[0]}`, detail: null }
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

function ToolIcon({ toolName }: { toolName: string }): React.JSX.Element {
  switch (toolName) {
    case 'bash':
      return <TerminalIcon aria-hidden="true" className="size-3.5" />
    case 'read':
      return <FileSearchIcon aria-hidden="true" className="size-3.5" />
    case 'write':
      return <FilePlus2Icon aria-hidden="true" className="size-3.5" />
    case 'edit':
      return <FilePenLineIcon aria-hidden="true" className="size-3.5" />
    default:
      return <WrenchIcon aria-hidden="true" className="size-3.5" />
  }
}

function ProgressiveToolOutput({ text }: { text: string }): React.JSX.Element {
  const lines = text.split('\n')
  const [visibleLineCount, setVisibleLineCount] = React.useState(1)

  React.useEffect(() => {
    if (visibleLineCount >= lines.length) return

    const timeoutId = window.setTimeout(
      () => setVisibleLineCount((current) => current + 1),
      TOOL_OUTPUT_REVEAL_INTERVAL_MS
    )
    return () => window.clearTimeout(timeoutId)
  }, [lines.length, visibleLineCount])

  return (
    <div className="mt-2 border-t border-border pt-2">
      {lines.slice(0, visibleLineCount).map((line, index) => (
        <div className="tool-trace__output-line" key={`${index}-${line}`}>
          {line || ' '}
        </div>
      ))}
    </div>
  )
}

function ToolTrace({
  part,
  isFollowedByActivity = false
}: {
  part: DynamicToolUIPart
  isFollowedByActivity?: boolean
}): React.JSX.Element {
  const [expanded, setExpanded] = React.useState(
    part.state === 'input-available' || part.state === 'input-streaming'
  )
  const [hasUserToggled, setHasUserToggled] = React.useState(false)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const isError = part.state === 'output-error'
  const isRunning = part.state === 'input-available' || part.state === 'input-streaming'
  const status = isError ? 'Failed' : isRunning ? 'Running' : 'Completed'
  const input = ToolInputSchema.safeParse(part.input)
  const output = 'output' in part ? ToolOutputSchema.safeParse(part.output) : undefined
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
  const contentId = `tool-trace-${part.toolCallId}`
  const isExpanded = hasUserToggled ? expanded : isRunning || (!isFollowedByActivity && expanded)
  const hasDetail = Boolean(tool.detail || detail)

  React.useEffect(() => {
    if (!isRunning || !isExpanded) return

    const frameId = window.requestAnimationFrame(() => {
      const panel = panelRef.current
      if (panel) panel.scrollTo({ top: panel.scrollHeight, behavior: 'auto' })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [detail, isExpanded, isRunning])

  return (
    <section
      className="thinking-block max-w-[42rem] text-sm text-text-tertiary"
      data-open={isExpanded}
    >
      <TooltipProvider delayDuration={500}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-controls={hasDetail ? contentId : undefined}
              aria-expanded={hasDetail ? isExpanded : undefined}
              className="h-auto gap-2 px-0 py-1 text-text-tertiary hover:bg-transparent hover:text-foreground"
              variant="ghost"
              onClick={() => {
                if (!hasDetail) return
                setHasUserToggled(true)
                setExpanded(!isExpanded)
              }}
            >
              <ToolIcon toolName={part.toolName} />
              <span className="font-medium text-foreground">{tool.title}</span>
              <span
                className={
                  isError
                    ? 'text-destructive'
                    : isRunning
                      ? 'thinking-block__label thinking-block__label--active'
                      : 'text-text-tertiary'
                }
                data-text={status}
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
            className={`thinking-block__panel-inner whitespace-pre-wrap rounded-md bg-surface-secondary px-3 py-2 font-mono text-xs${
              isRunning && isExpanded ? ' thinking-block__panel-inner--streaming' : ''
            }`}
            id={contentId}
            ref={panelRef}
          >
            {tool.detail ? <div className="text-text-tertiary">{tool.detail}</div> : null}
            {detail ? <ProgressiveToolOutput key={detail} text={detail} /> : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function ThinkingBlock({
  id,
  isAnswerStreaming = false,
  isStreaming,
  orbState = 'working',
  text
}: ThinkingBlockProps): React.JSX.Element | null {
  const isThinking = isStreaming && !isAnswerStreaming
  const [expanded, setExpanded] = React.useState(isThinking)
  const [hasUserToggled, setHasUserToggled] = React.useState(false)
  const wasAnswerStreaming = React.useRef(isAnswerStreaming)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const contentId = `thinking-${id}`
  const label = isThinking ? 'Thinking' : 'Thought summary'
  const shouldAutoFollow = isThinking && expanded && !hasUserToggled

  React.useEffect(() => {
    if (isAnswerStreaming && !wasAnswerStreaming.current && !hasUserToggled) {
      setExpanded(false)
    }

    wasAnswerStreaming.current = isAnswerStreaming
  }, [hasUserToggled, isAnswerStreaming])

  React.useEffect(() => {
    if (!shouldAutoFollow) return

    const frameId = window.requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return

      panel.scrollTo({
        top: panel.scrollHeight,
        behavior: 'auto'
      })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [shouldAutoFollow, text])

  if (!text && !isThinking) return null

  return (
    <section
      className="thinking-block max-w-[42rem] text-sm text-text-tertiary"
      data-open={expanded}
    >
      <Button
        aria-controls={contentId}
        aria-expanded={expanded}
        className="h-auto gap-2 px-0 py-1 text-text-tertiary hover:bg-transparent hover:text-foreground"
        variant="ghost"
        onClick={() => {
          setHasUserToggled(true)
          setExpanded((current) => !current)
        }}
      >
        <IconSwap
          from={
            <ThinkingOrb
              data-orb-state={orbState}
              data-testid="thinking-orb"
              size={20}
              state={orbState}
            />
          }
          state={isThinking ? 'from' : 'to'}
          to={<BrainIcon className="size-3.5" />}
        />
        <span
          className={
            isThinking
              ? 'thinking-block__label thinking-block__label--active'
              : 'thinking-block__label'
          }
          data-text={label}
        >
          {label}
        </span>
        <span aria-hidden="true" className="thinking-block__chevron">
          <ChevronDownIcon className="size-3.5" />
        </span>
      </Button>
      <div className="thinking-block__panel" data-testid="thinking-panel">
        <div
          aria-hidden={!expanded}
          className={`thinking-block__panel-inner whitespace-pre-wrap rounded-md bg-surface-secondary px-3 py-2${
            shouldAutoFollow ? ' thinking-block__panel-inner--streaming' : ''
          }`}
          id={contentId}
          ref={panelRef}
        >
          {text}
        </div>
      </div>
    </section>
  )
}

export { ThinkingBlock, ToolTrace, thinkingOrbStates, type ThinkingOrbState }
