import { createHash } from 'node:crypto'
import type { ChatProviderMessage, ChatProviderToolResultPart } from '@mico/ai-providers'
import { type ChatSkillInvocationPart, ChatSkillInvocationPartSchema } from '@shared/ai/skills'
import {
  ChatDocumentPartSchema,
  type ChatMessage,
  ChatMessageRoleSchema,
  ChatReasoningPartSchema,
  type ChatToolTracePart,
  ChatToolTracePartSchema
} from '@shared/data/schemas/chat'
import * as z from 'zod'

import { parseToolTracePayload, toToolTracePart } from './tool-trace-presentation'

/**
 * The renderer-visible form of a persisted chat message: the parts that carry
 * transcript meaning, without model-only payload such as tool call arguments.
 */
type VisibleMessage = {
  role: ChatMessage['role']
  parts: Array<
    | { type: 'text'; text: string }
    | { type: 'document'; name: string; text: string }
    | { type: 'reasoning'; text: string }
    | ChatToolTracePart
    | ChatSkillInvocationPart
  >
  metadata?: { completionState?: 'complete' | 'stopped' }
}
/** One replayable model step: its response and the observations it caused. */
type AgentStep = {
  index: number
  assistant: Extract<ChatProviderMessage, { role: 'assistant' }>
  toolResults: ChatProviderToolResultPart[]
  continuationPrompt?: string
}
/** Run-level tool activity totals appended once when a run reaches a terminal state. */
type ToolTraceSummary = {
  total: number
  succeeded: number
  failed: number
  summary: string
}
/**
 * Narrow projection used only by `assembleTranscript`.
 *
 * It deliberately excludes table columns that cannot affect the renderer
 * transcript, while retaining `run_id` to attach sanitized tool traces to
 * their finalized assistant message.
 */
type LoadEventRow = {
  run_id: string
  kind:
    | 'assistant_output_finalized'
    | 'agent_step_recorded'
    | 'tool_trace_recorded'
    | 'tool_trace_summary_recorded'
    | 'user_message_recorded'
  payload_json: string
  payload_digest: string
}

const VisibleMessageSchema: z.ZodType<VisibleMessage> = z.object({
  role: ChatMessageRoleSchema,
  parts: z.array(
    z.union([
      z.object({ type: z.literal('text'), text: z.string() }),
      ChatDocumentPartSchema,
      ChatReasoningPartSchema,
      ChatToolTracePartSchema,
      ChatSkillInvocationPartSchema
    ])
  ),
  metadata: z.object({ completionState: z.enum(['complete', 'stopped']).optional() }).optional()
})
const MessagePayloadSchema = z.object({ message: VisibleMessageSchema })
const ToolTraceSummarySchema: z.ZodType<ToolTraceSummary> = z.object({
  total: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  summary: z.string().trim().min(1).max(500)
})
const ToolTraceSummaryPayloadSchema = z.object({ summary: ToolTraceSummarySchema })
const AgentStepPayloadSchema: z.ZodType<{ step: AgentStep }> = z.object({
  step: z.object({
    index: z.number().int().positive(),
    assistant: z.custom<Extract<ChatProviderMessage, { role: 'assistant' }>>(),
    toolResults: z.array(z.custom<ChatProviderToolResultPart>()),
    continuationPrompt: z.string().min(1).optional()
  })
})

/**
 * Persisted transcripts preserve the exact stream order: an agent run is the
 * activity between two text outputs, so reasoning, tool traces and interim
 * texts keep their positions instead of collapsing into one trailing blob.
 * Writers append events in stream order and both transcript projections
 * (`assembleTranscript` and `assembleReplayEvents`) read them back in the
 * same order; nothing may reorder, deduplicate, or rewrite persisted events.
 */
function assertPayloadDigest(row: { payload_json: string; payload_digest: string }): void {
  if (digest(row.payload_json) !== row.payload_digest)
    throw new Error('Runtime event payload digest does not match its stored value.')
}
function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
function visibleMessage(message: ChatMessage): VisibleMessage {
  const parts: VisibleMessage['parts'] = []
  for (const part of message.parts) {
    if (part.type === 'text') parts.push({ type: 'text', text: part.text })
    else if (part.type === 'document') parts.push(part)
    else if (part.type === 'reasoning') parts.push({ type: 'reasoning', text: part.text })
    else if (part.type === 'tool-trace' || part.type === 'data-skill-invocation') parts.push(part)
  }
  const visible: VisibleMessage = {
    role: message.role,
    parts
  }
  if (message.metadata) visible.metadata = message.metadata
  return VisibleMessageSchema.parse(visible)
}
function parseMessagePayload(value: string): { message: VisibleMessage } {
  return MessagePayloadSchema.parse(JSON.parse(value))
}
function parseToolTraceSummaryPayload(value: string): { summary: ToolTraceSummary } {
  return ToolTraceSummaryPayloadSchema.parse(JSON.parse(value))
}
function parseAgentStepPayload(value: string): { step: AgentStep } {
  return AgentStepPayloadSchema.parse(JSON.parse(value))
}
function sanitizeAgentStep(step: AgentStep): AgentStep {
  if (!Number.isInteger(step.index) || step.index < 1 || step.assistant.role !== 'assistant')
    throw new Error('Invalid agent step.')
  return AgentStepPayloadSchema.parse({ step: JSON.parse(JSON.stringify(step)) }).step
}
function toReplayAssistant(
  assistant: Extract<ChatProviderMessage, { role: 'assistant' }>
): Extract<ChatProviderMessage, { role: 'assistant' }> {
  return {
    ...assistant,
    parts: assistant.parts.filter(
      (part) => part.type !== 'reasoning' || Boolean(part.providerMetadata)
    )
  }
}
/**
 * Reassemble the renderer transcript from persisted runtime events, in stream order.
 *
 * Finalized outputs that embed their tool traces already carry the exact
 * stream order; event reassembly only fills legacy or interrupted runs.
 */
function assembleTranscript(rows: LoadEventRow[]): VisibleMessage[] {
  const activityPartsByRun = new Map<string, ChatMessage['parts']>()
  for (const row of rows) {
    const current = activityPartsByRun.get(row.run_id) ?? []
    if (row.kind === 'agent_step_recorded') {
      const assistant = parseAgentStepPayload(row.payload_json).step.assistant
      // Only tool-use rounds precede another model response. The terminal round's reasoning is
      // already preserved in assistant_output_finalized, so replaying it here would duplicate it.
      if (assistant.parts.some((part) => part.type === 'tool-call')) {
        current.push(
          ...assistant.parts.flatMap((part) =>
            part.type === 'reasoning' ? [{ type: 'reasoning' as const, text: part.text }] : []
          )
        )
      }
    } else if (row.kind === 'tool_trace_recorded') {
      current.push(toToolTracePart(parseToolTracePayload(row.payload_json).trace))
    }
    if (current.length) activityPartsByRun.set(row.run_id, current)
  }
  for (const row of rows) {
    if (row.kind === 'tool_trace_summary_recorded') parseToolTraceSummaryPayload(row.payload_json)
  }
  return rows.flatMap((row) => {
    if (
      row.kind === 'agent_step_recorded' ||
      row.kind === 'tool_trace_recorded' ||
      row.kind === 'tool_trace_summary_recorded'
    )
      return []
    const message = parseMessagePayload(row.payload_json).message
    if (row.kind !== 'assistant_output_finalized') return [message]
    // Finalized outputs that embed their tool traces already carry the exact
    // stream order; event reassembly only fills legacy or interrupted runs.
    if (message.parts.some((part) => part.type === 'tool-trace')) return [message]
    return [
      {
        ...message,
        parts: [...(activityPartsByRun.get(row.run_id) ?? []), ...message.parts]
      }
    ]
  })
}
/** Replay agent steps as alternating assistant/tool messages in recorded order. */
function assembleReplayEvents(
  rows: Array<{ payload_json: string; payload_digest: string }>,
  finalized?: VisibleMessage
): ChatProviderMessage[] {
  const messages: ChatProviderMessage[] = []
  let lastStep: AgentStep | undefined
  for (const row of rows) {
    assertPayloadDigest(row)
    const step = parseAgentStepPayload(row.payload_json).step
    messages.push(toReplayAssistant(step.assistant))
    if (step.toolResults.length) messages.push({ role: 'tool', parts: step.toolResults })
    if (step.continuationPrompt)
      messages.push({ role: 'user', parts: [{ type: 'text', text: step.continuationPrompt }] })
    lastStep = step
  }
  // Empty observations identify a recorded terminal response. Older logs contain
  // only tool rounds; cancelled streams can also have unrecorded visible text.
  if (finalized && (!lastStep || lastStep.toolResults.length || lastStep.continuationPrompt)) {
    const recordedText = messages
      .filter((message) => message.role === 'assistant')
      .flatMap((message) => message.parts)
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('')
    const visibleText = finalized.parts
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('')
    // The display cap may shorten already-recorded text and append an ellipsis.
    // Such a visible projection contributes no additional provider response.
    const visibleContent = visibleText.endsWith('…') ? visibleText.slice(0, -1) : visibleText
    if (recordedText && recordedText.startsWith(visibleContent)) return messages
    const text =
      recordedText && visibleText.startsWith(recordedText)
        ? visibleText.slice(recordedText.length)
        : visibleText
    if (text) messages.push({ role: 'assistant', parts: [{ type: 'text', text }] })
  }
  return messages
}

export type { AgentStep, LoadEventRow, ToolTraceSummary, VisibleMessage }
export {
  assembleReplayEvents,
  assembleTranscript,
  assertPayloadDigest,
  digest,
  parseAgentStepPayload,
  parseMessagePayload,
  sanitizeAgentStep,
  visibleMessage
}
