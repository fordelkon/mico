import * as z from 'zod'

import {
  getToolTracePresentation,
  getWriteOperation,
  ToolTraceSourceInputSchema
} from '@shared/ai/tool-trace'
import { toolLabel } from '@shared/ai/tool-presentation'
import {
  ChatToolTracePresentationSchema,
  type ChatToolTraceInput,
  type ChatToolTracePresentation,
  type ChatToolTracePart
} from '@shared/data/schemas/chat'
import type { ToolExecutionTrace } from '../tools/tool-contract'

type StoredToolTrace = {
  toolCallId: string
  toolName: string
  input: ChatToolTraceInput
  presentation?: ChatToolTracePresentation
  status: 'completed' | 'failed'
  summary: string
  startedAt: number
  finishedAt: number
}
type TruncatedToolPresentationText = { isTruncated: boolean; text: string }

const StoredToolTraceSchema: z.ZodType<StoredToolTrace> = z.object({
  toolCallId: z.string().trim().min(1).max(200),
  toolName: z.string().trim().min(1).max(64),
  input: z.object({
    command: z.string().trim().min(1).max(240).optional(),
    query: z.string().min(1).max(512).optional(),
    mode: z.enum(['files', 'content']).optional(),
    glob: z.string().min(1).max(512).optional(),
    editCount: z.number().int().positive().max(100).optional(),
    path: z.string().trim().min(1).max(4_096).optional()
  }),
  presentation: ChatToolTracePresentationSchema.optional(),
  status: z.enum(['completed', 'failed']),
  summary: z.string().trim().min(1).max(500),
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative()
})
const ToolTracePayloadSchema = z.object({ trace: StoredToolTraceSchema })
const TOOL_TRACE_PRESENTATION_MAX_BYTES = 64 * 1024

function toStoredToolTrace(trace: ToolExecutionTrace): StoredToolTrace {
  const toolName = trace.toolName.trim().slice(0, 64) || 'tool'
  const parsed = ToolTraceSourceInputSchema.safeParse(trace.input)
  const source = parsed.success ? parsed.data : undefined
  const input = toToolTraceInput(source)
  const status = trace.isError ? 'failed' : 'completed'
  const startedAt = Math.max(0, Math.trunc(trace.startedAt))
  const finishedAt = Math.max(startedAt, Math.trunc(trace.finishedAt))
  return {
    toolCallId: trace.toolCallId.trim().slice(0, 200) || 'unknown-call',
    toolName,
    input,
    presentation: toToolTracePresentation(toolName, source, trace.output),
    status,
    summary: toolTraceSummary(toolName, input, status, trace.output),
    startedAt,
    finishedAt
  }
}
function parseToolTracePayload(value: string): { trace: StoredToolTrace } {
  return ToolTracePayloadSchema.parse(JSON.parse(value))
}
function toToolTraceInput(
  input: z.infer<typeof ToolTraceSourceInputSchema> | undefined
): ChatToolTraceInput {
  if (!input) return {}
  const traceInput: ChatToolTraceInput = {}
  if (input.query) traceInput.query = input.query.slice(0, 512)
  if (input.mode) traceInput.mode = input.mode
  if (input.glob) traceInput.glob = input.glob.slice(0, 512)
  if (input.path?.trim()) traceInput.path = input.path.trim().slice(0, 4_096)
  if (input.command?.trim())
    traceInput.command = input.command.trim().split(/\r?\n/, 1)[0]!.slice(0, 240)
  if (input.edits?.length) traceInput.editCount = input.edits.length
  return traceInput
}
function truncateToolPresentationText(text: string): TruncatedToolPresentationText {
  if (Buffer.byteLength(text) <= TOOL_TRACE_PRESENTATION_MAX_BYTES)
    return { isTruncated: false, text }

  let truncated = Buffer.from(text).subarray(0, TOOL_TRACE_PRESENTATION_MAX_BYTES).toString()
  while (Buffer.byteLength(truncated) > TOOL_TRACE_PRESENTATION_MAX_BYTES)
    truncated = truncated.slice(0, -1)
  return { isTruncated: true, text: truncated }
}
function toToolTracePresentation(
  toolName: string,
  input: z.infer<typeof ToolTraceSourceInputSchema> | undefined,
  output: string
): StoredToolTrace['presentation'] {
  // Finished legacy edits retain an empty preview even when no edit fields were recorded.
  const presentation = getToolTracePresentation(
    toolName,
    input ? { ...input, edits: input.edits ?? [] } : undefined,
    output
  )
  if (!presentation) return undefined
  if (presentation.type === 'edit') {
    const isTruncated =
      Buffer.byteLength(JSON.stringify(presentation.edits)) > TOOL_TRACE_PRESENTATION_MAX_BYTES
    return { ...presentation, edits: isTruncated ? [] : presentation.edits, isTruncated }
  }
  const preview = truncateToolPresentationText(presentation.content)
  return { ...presentation, content: preview.text, isTruncated: preview.isTruncated }
}
function toolTraceSummary(
  toolName: string,
  input: ChatToolTraceInput,
  status: StoredToolTrace['status'],
  output: string
): string {
  if (status === 'failed') return 'Tool execution failed.'
  switch (toolName) {
    case 'Glob':
    case 'Grep':
      return output.split('\n')[0].slice(0, 500)
    case 'Read': {
      const lineCount = output
        .split('\n')
        .filter((line) => line.trim() && !line.startsWith('[More content available.')).length
      return `Read ${lineCount} ${lineCount === 1 ? 'line' : 'lines'}.`
    }
    case 'Write': {
      const operation = getWriteOperation(output)
      if (operation === 'created') return input.path ? `Created ${input.path}.` : 'Created file.'
      if (operation === 'replaced') return input.path ? `Replaced ${input.path}.` : 'Replaced file.'
      return input.path ? `Wrote ${input.path}.` : 'Wrote file.'
    }
    case 'Edit':
      return input.path
        ? `Edited ${input.path}${input.editCount ? ` · ${input.editCount} changes` : ''}.`
        : 'Edited file.'
    case 'Bash':
      return 'Command completed.'
    default:
      return `${toolLabel(toolName)} completed.`
  }
}
function toToolTracePart(trace: StoredToolTrace): ChatToolTracePart {
  if (trace.status === 'failed') {
    return {
      type: 'tool-trace',
      toolCallId: trace.toolCallId,
      toolName: trace.toolName,
      input: trace.input,
      presentation: trace.presentation,
      state: 'output-error',
      errorText: trace.summary
    }
  }
  return {
    type: 'tool-trace',
    toolCallId: trace.toolCallId,
    toolName: trace.toolName,
    input: trace.input,
    presentation: trace.presentation,
    state: 'output-available',
    output: trace.summary
  }
}
/** The persisted-display form of a finished tool execution, identical to replayed traces. */
function toDisplayToolTrace(trace: ToolExecutionTrace): ChatToolTracePart {
  return toToolTracePart(toStoredToolTrace(trace))
}

export { toDisplayToolTrace, toStoredToolTrace, toToolTracePart, parseToolTracePayload }
export type { StoredToolTrace }
