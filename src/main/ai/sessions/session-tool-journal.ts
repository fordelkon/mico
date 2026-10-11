import type {
  ChatProviderMessage,
  ChatProviderToolResultPart,
  ProviderUsage
} from '@mico/ai-providers'
import * as z from 'zod'
import type { SessionDatabase } from '../../data/session-database'
import type { ToolExecutionTrace } from '../tools/tool-contract'
import {
  assertPayloadDigest,
  canonicalJson,
  type RunRow,
  type SessionEventLog
} from './session-event-log'
import {
  type AgentStep,
  assembleReplayEvents,
  parseAgentStepPayload,
  parseMessagePayload
} from './session-transcript'
import { toStoredToolTrace } from './tool-trace-presentation'

type ModelStepAccepted = Pick<AgentStep, 'index' | 'assistant'> & { usage?: ProviderUsage }
type ToolExecutionStarted = { index: number; toolCallId: string; startedAt: number }
type ToolExecutionSettled = {
  index: number
  result: ChatProviderToolResultPart
  trace: ToolExecutionTrace
}
type JournalRow = {
  kind: string
  payload_json: string
  payload_digest: string
  session_sequence: number
}
/**
 * Normalized per-step provider usage. Every field is optional because providers
 * report what their protocol exposes; absent fields stay absent instead of
 * becoming zero.
 */
const ModelStepUsageSchema = z.object({
  cachedInputTokens: z.number().finite().nonnegative().optional(),
  inputTokens: z.number().finite().nonnegative().optional(),
  outputTokens: z.number().finite().nonnegative().optional(),
  reasoningTokens: z.number().finite().nonnegative().optional(),
  totalTokens: z.number().finite().nonnegative().optional()
})
class SessionToolJournal {
  constructor(
    private readonly database: SessionDatabase,
    private readonly log: SessionEventLog
  ) {}
  rows(runId: string): JournalRow[] {
    // SAFETY: schema-owned event writers and fixed SQL columns establish this stored row shape.
    const rows = this.database.connection
      .prepare(
        'SELECT kind,payload_json,payload_digest,session_sequence FROM runtime_events WHERE run_id = ? ORDER BY session_sequence'
      )
      .all(runId) as JournalRow[]
    for (const row of rows) assertPayloadDigest(row)
    return rows
  }
  recordModelStep(run: RunRow, step: ModelStepAccepted): void {
    if (!Number.isInteger(step.index) || step.index < 1 || step.assistant.role !== 'assistant')
      throw new Error('Invalid model step.')
    // Usage is normalized here, at the journaling boundary, so invalid provider
    // counters can never enter persisted history. Absence stays absence.
    const usage = step.usage === undefined ? undefined : ModelStepUsageSchema.parse(step.usage)
    this.record(
      run,
      'model_step_accepted',
      usage === undefined ? { index: step.index, assistant: step.assistant } : { ...step, usage },
      step.index
    )
  }
  recordStarted(run: RunRow, started: ToolExecutionStarted): void {
    this.assertCall(run.id, started.index, started.toolCallId)
    this.record(run, 'tool_execution_started', started, started.index, started.toolCallId)
  }
  recordSettled(run: RunRow, settled: ToolExecutionSettled): void {
    const call = this.assertCall(run.id, settled.index, settled.result.toolCallId)
    const { result, trace } = settled
    if (
      call.toolName !== result.toolName ||
      trace.toolCallId !== result.toolCallId ||
      trace.toolName !== result.toolName ||
      trace.output !== result.output ||
      trace.isError !== result.isError
    )
      throw new Error('Tool settlement does not match the accepted call.')
    this.record(
      run,
      'tool_execution_settled',
      { ...settled, trace: toStoredToolTrace(trace) },
      settled.index,
      result.toolCallId
    )
  }
  hasUnknown(turnId: string): boolean {
    // SAFETY: schema-owned event writers and fixed SQL columns establish this stored row shape.
    const runs = this.database.connection
      .prepare('SELECT id FROM runs WHERE turn_id = ?')
      .all(turnId) as { id: string }[]
    return runs.some(({ id }) => {
      const rows = this.rows(id)
      return rows
        .filter((row) => row.kind === 'tool_execution_started')
        .some((row) => {
          // SAFETY: schema-owned event writers and fixed SQL columns establish this stored row shape.
          const start = JSON.parse(row.payload_json) as ToolExecutionStarted
          return !rows.some((other) => {
            if (other.kind !== 'tool_execution_settled') return false
            // SAFETY: schema-owned event writers and fixed SQL columns establish this stored row shape.
            const settled = JSON.parse(other.payload_json) as ToolExecutionSettled
            return settled.index === start.index && settled.result.toolCallId === start.toolCallId
          })
        })
    })
  }
  replay(runId: string): ChatProviderMessage[] {
    const rows = this.rows(runId)
    const accepted = rows.filter((row) => row.kind === 'model_step_accepted')
    const legacy = rows.filter((row) => row.kind === 'agent_step_recorded')
    if (!accepted.length) {
      const finalized = rows.find((row) => row.kind === 'assistant_output_finalized')
      return assembleReplayEvents(
        legacy,
        finalized ? parseMessagePayload(finalized.payload_json).message : undefined
      )
    }
    // SAFETY: schema-owned event writers and fixed SQL columns establish this stored row shape.
    const steps = [
      ...accepted,
      ...legacy.filter(
        (row) =>
          !accepted.some(
            (other) =>
              (JSON.parse(other.payload_json) as ModelStepAccepted).index ===
              parseAgentStepPayload(row.payload_json).step.index
          )
      )
    ].sort((a, b) => a.session_sequence - b.session_sequence)
    const messages: ChatProviderMessage[] = []
    for (const row of steps) {
      // SAFETY: schema-owned event writers and fixed SQL columns establish this stored row shape.
      const step =
        row.kind === 'agent_step_recorded'
          ? parseAgentStepPayload(row.payload_json).step
          : (JSON.parse(row.payload_json) as ModelStepAccepted)
      messages.push({
        ...step.assistant,
        parts: step.assistant.parts.filter(
          (part) => part.type !== 'reasoning' || Boolean(part.providerMetadata)
        )
      })
      const results: ChatProviderToolResultPart[] =
        row.kind === 'agent_step_recorded'
          ? parseAgentStepPayload(row.payload_json).step.toolResults
          : step.assistant.parts.flatMap((part) => {
              if (part.type !== 'tool-call') return []
              // SAFETY: schema-owned event writers and fixed SQL columns establish this stored row shape.
              const settlement = rows.find(
                (other) =>
                  other.kind === 'tool_execution_settled' &&
                  (JSON.parse(other.payload_json) as ToolExecutionSettled).index === step.index &&
                  (JSON.parse(other.payload_json) as ToolExecutionSettled).result.toolCallId ===
                    part.toolCallId
              )
              // SAFETY: schema-owned event writers and fixed SQL columns establish this stored row shape.
              if (settlement) {
                // SAFETY: the matched event was written from a validated tool settlement.
                const settled = JSON.parse(settlement.payload_json) as ToolExecutionSettled
                return [settled.result]
              }
              // SAFETY: schema-owned event writers and fixed SQL columns establish this stored row shape.
              const started = rows.some(
                (other) =>
                  other.kind === 'tool_execution_started' &&
                  (JSON.parse(other.payload_json) as ToolExecutionStarted).index === step.index &&
                  (JSON.parse(other.payload_json) as ToolExecutionStarted).toolCallId ===
                    part.toolCallId
              )
              if (started)
                return [
                  {
                    type: 'tool-result' as const,
                    toolCallId: part.toolCallId,
                    toolName: part.toolName,
                    output:
                      'Tool execution outcome is unknown. Inspect the workspace before starting a new request.',
                    isError: true
                  }
                ]
              return [
                {
                  type: 'tool-result' as const,
                  toolCallId: part.toolCallId,
                  toolName: part.toolName,
                  output:
                    'This tool call was not executed because the run ended before execution started. Review the request and submit it again if needed.',
                  isError: true
                }
              ]
            })
      if (results.length) messages.push({ role: 'tool', parts: results })
      const legacyStep = legacy.find(
        (other) => parseAgentStepPayload(other.payload_json).step.index === step.index
      )
      const continuation = legacyStep
        ? parseAgentStepPayload(legacyStep.payload_json).step.continuationPrompt
        : undefined
      if (continuation)
        messages.push({ role: 'user', parts: [{ type: 'text', text: continuation }] })
    }
    return messages
  }
  private assertCall(runId: string, index: number, callId: string) {
    // SAFETY: schema-owned event writers and fixed SQL columns establish this stored row shape.
    const row = this.rows(runId).find(
      (row) =>
        row.kind === 'model_step_accepted' &&
        (JSON.parse(row.payload_json) as ModelStepAccepted).index === index
    )
    // SAFETY: schema-owned event writers and fixed SQL columns establish this stored row shape.
    const call =
      row &&
      (JSON.parse(row.payload_json) as ModelStepAccepted).assistant.parts.find(
        (part) => part.type === 'tool-call' && part.toolCallId === callId
      )
    if (!call || call.type !== 'tool-call') throw new Error('Tool execution has no accepted call.')
    return call
  }
  private record(
    run: RunRow,
    kind: 'model_step_accepted' | 'tool_execution_started' | 'tool_execution_settled',
    payload:
      | ModelStepAccepted
      | ToolExecutionStarted
      | {
          index: number
          result: ChatProviderToolResultPart
          trace: ReturnType<typeof toStoredToolTrace>
        },
    index: number,
    callId?: string
  ): void {
    if (run.status !== 'running')
      throw new Error('Tool journal cannot be written after the run ended.')
    const existing = this.rows(run.id).find((row) => {
      if (row.kind !== kind) return false
      // SAFETY: schema-owned event writers and fixed SQL columns establish this stored row shape.
      const value = JSON.parse(row.payload_json) as {
        index: number
        toolCallId?: string
        result?: ChatProviderToolResultPart
      }
      return (
        value.index === index &&
        (!callId || (value.toolCallId ?? value.result?.toolCallId) === callId)
      )
    })
    const normalized = JSON.parse(JSON.stringify(payload))
    if (existing) {
      if (canonicalJson(normalized) !== existing.payload_json)
        throw new Error('Tool journal identity already has different content.')
      return
    }
    this.log.appendEvent(run, kind, normalized)
  }
}

export type { ModelStepAccepted, ToolExecutionSettled, ToolExecutionStarted }
export { SessionToolJournal }
