import * as z from 'zod'

import type { JsonObject } from '@mico/ai-providers'
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
const ToolTraceSourceInputSchema = z.object({
  command: z.string().optional(),
  content: z.string().optional(),
  edits: z
    .array(z.object({ newText: z.string(), oldText: z.string() }))
    .max(100)
    .optional(),
  path: z.string().optional()
})
const TOOL_TRACE_PRESENTATION_MAX_BYTES = 64 * 1024

function toStoredToolTrace(trace: ToolExecutionTrace): StoredToolTrace {
  const toolName = trace.toolName.trim().slice(0, 64) || 'tool'
  const input = toToolTraceInput(trace.input)
  const status = trace.isError ? 'failed' : 'completed'
  const startedAt = Math.max(0, Math.trunc(trace.startedAt))
  const finishedAt = Math.max(startedAt, Math.trunc(trace.finishedAt))
  return {
    toolCallId: trace.toolCallId.trim().slice(0, 200) || 'unknown-call',
    toolName,
    input,
    presentation: toToolTracePresentation(toolName, trace.input, trace.output),
    status,
    summary: toolTraceSummary(toolName, input, status, trace.output),
    startedAt,
    finishedAt
  }
}
function parseToolTracePayload(value: string): { trace: StoredToolTrace } {
  return ToolTracePayloadSchema.parse(JSON.parse(value))
}
function toToolTraceInput(input: JsonObject): ChatToolTraceInput {
  const parsed = ToolTraceSourceInputSchema.safeParse(input)
  if (!parsed.success) return {}
  const traceInput: ChatToolTraceInput = {}
  if (parsed.data.path?.trim()) traceInput.path = parsed.data.path.trim().slice(0, 4_096)
  if (parsed.data.command?.trim())
    traceInput.command = parsed.data.command.trim().split(/\r?\n/, 1)[0]!.slice(0, 240)
  if (parsed.data.edits?.length) traceInput.editCount = parsed.data.edits.length
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
  input: JsonObject,
  output: string
): StoredToolTrace['presentation'] {
  const parsed = ToolTraceSourceInputSchema.safeParse(input)
  if (!parsed.success) return undefined

  switch (toolName) {
    case 'read': {
      const preview = truncateToolPresentationText(output)
      return { content: preview.text, isTruncated: preview.isTruncated, type: 'read' }
    }
    case 'bash': {
      const preview = truncateToolPresentationText(output)
      return { content: preview.text, isTruncated: preview.isTruncated, type: 'bash' }
    }
    case 'write': {
      if (parsed.data.content === undefined) return undefined
      const preview = truncateToolPresentationText(parsed.data.content)
      return {
        content: preview.text,
        isTruncated: preview.isTruncated,
        operation: output.startsWith('Created ')
          ? 'created'
          : output.startsWith('Replaced ')
            ? 'replaced'
            : 'unknown',
        type: 'write'
      }
    }
    case 'edit': {
      const edits = parsed.data.edits ?? []
      const serialized = JSON.stringify(edits)
      return {
        edits: Buffer.byteLength(serialized) <= TOOL_TRACE_PRESENTATION_MAX_BYTES ? edits : [],
        isTruncated: Buffer.byteLength(serialized) > TOOL_TRACE_PRESENTATION_MAX_BYTES,
        type: 'edit'
      }
    }
    default:
      return undefined
  }
}
function toolTraceSummary(
  toolName: string,
  input: ChatToolTraceInput,
  status: StoredToolTrace['status'],
  output: string
): string {
  if (status === 'failed') return 'Tool execution failed.'
  switch (toolName) {
    case 'read': {
      const lineCount = output
        .split('\n')
        .filter((line) => line.trim() && !line.startsWith('[More content available.')).length
      return `Read ${lineCount} ${lineCount === 1 ? 'line' : 'lines'}.`
    }
    case 'write':
      if (output.startsWith('Created '))
        return input.path ? `Created ${input.path}.` : 'Created file.'
      if (output.startsWith('Replaced '))
        return input.path ? `Replaced ${input.path}.` : 'Replaced file.'
      return input.path ? `Wrote ${input.path}.` : 'Wrote file.'
    case 'edit':
      return input.path
        ? `Edited ${input.path}${input.editCount ? ` · ${input.editCount} changes` : ''}.`
        : 'Edited file.'
    case 'bash':
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
