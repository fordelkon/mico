import { createHash } from 'node:crypto'
import type { ChatProviderMessage } from '@mico/ai-providers'
import { toolLabel } from '@shared/ai/tool-presentation'
import type { ChatMessage } from '@shared/data/schemas/chat'
import type { ExecutionProfileSnapshot } from '@shared/data/schemas/session'
import * as z from 'zod'
import type { SessionDatabase } from '../../data/session-database'
import { toProviderReplayContext } from '../chat/conversation-context'
import type { ToolExecutionTrace } from '../tools/tool-contract'
import {
  type AgentStep,
  assembleReplayEvents,
  assembleTranscript,
  type LoadEventRow,
  parseMessagePayload,
  type ToolTraceSummary,
  type VisibleMessage,
  visibleMessage
} from './session-transcript'
import {
  parseToolTracePayload,
  type StoredToolTrace,
  toStoredToolTrace
} from './tool-trace-presentation'

type ProviderUserMessage = Extract<ChatProviderMessage, { role: 'system' | 'user' }> & {
  role: 'user'
}
const ContextPayloadSchema = z.object({
  messages: z.array(
    z.object({
      role: z.literal('user'),
      parts: z.array(
        z.union([
          z.object({ type: z.literal('text'), text: z.string() }),
          z.object({
            type: z.literal('reasoning'),
            text: z.string(),
            providerMetadata: z.record(z.string(), z.record(z.string(), z.json())).optional()
          })
        ])
      ),
      providerMetadata: z.record(z.string(), z.record(z.string(), z.json())).optional()
    })
  )
})

const ContextCheckpointSchema = z
  .object({
    trigger: z.literal('manual'),
    summary: z
      .string()
      .min(1)
      .max(100_000)
      .refine((value) => value.trim().length > 0),
    coverage: z.object({ throughSequence: z.number().int().positive() }),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict()
type ContextCheckpoint = z.infer<typeof ContextCheckpointSchema>
/**
 * Durable outcome record for one manual compaction attempt. A summary
 * rejection, a changed source or session profile, and a cancellation all land
 * here so a later process can explain why no checkpoint was accepted.
 */
const CompactionNoticeSchema = z
  .object({
    reason: z.enum(['rejected', 'source_changed', 'profile_changed', 'cancelled', 'failed']),
    message: z.string().min(1).max(2_000),
    coverage: z.object({ throughSequence: z.number().int().positive() }),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict()
type CompactionNotice = z.infer<typeof CompactionNoticeSchema>
/** Expected business rejection while selecting a safe compaction boundary. */
class CheckpointBoundaryRejected extends Error {}
type CompactionEvent = {
  id: string
  run_id: string
  session_sequence: number
  kind: string
  payload_json: string
  payload_digest: string
}

type RuntimeEventPayloads = {
  context_checkpoint_recorded: ContextCheckpoint
  compaction_notice_recorded: CompactionNotice
  turn_context_recorded: { messages: ProviderUserMessage[] }
  run_started: {
    attempt: number
    profile: ExecutionProfileSnapshot
    requestId: string
    retryRunId?: string
  }
  user_message_recorded: { message: VisibleMessage }
  model_request_started: Record<string, never>
  assistant_output_finalized: { message: VisibleMessage }
  tool_trace_recorded: { trace: StoredToolTrace; index?: number }
  tool_trace_summary_recorded: { summary: ToolTraceSummary }
  agent_step_recorded: { step: AgentStep }
  model_step_accepted: {
    index: number
    assistant: Extract<ChatProviderMessage, { role: 'assistant' }>
    usage?: import('@mico/ai-providers').ProviderUsage
  }
  tool_execution_started: { index: number; toolCallId: string; startedAt: number }
  tool_execution_settled: {
    index: number
    result: import('@mico/ai-providers').ChatProviderToolResultPart
    trace: StoredToolTrace
  }
  assistant_output_snapshot: { message: VisibleMessage }
  run_failed: { code: string; message: string }
  run_cancelled: Record<string, never>
  run_completed: Record<string, never>
}
type RuntimeEventKind = keyof RuntimeEventPayloads
type JsonValue = boolean | JsonObject | JsonValue[] | null | number | string
type JsonObject = { [key: string]: JsonValue }
/** Complete `runs` table row; runtime methods need its persistence identity and lifecycle state. */
type RunRow = {
  id: string
  session_id: string
  turn_id: string
  attempt: number
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
}
type EventLogDependencies = {
  database: SessionDatabase
  createId: () => string
  now: () => number
}

/** Internal session task log. Lifecycle transactions remain owned by the runtime. */
class SessionEventLog {
  constructor(private readonly dependencies: EventLogDependencies) {}

  recordToolTrace(run: RunRow, trace: ToolExecutionTrace, index?: number): void {
    if (run.status !== 'running' || this.findTerminalEvent(run.id)) return
    const existing = this.dependencies.database.connection
      .prepare(
        "SELECT id FROM runtime_events WHERE run_id = ? AND kind = 'tool_trace_recorded' AND json_extract(payload_json, '$.trace.toolCallId') = ? AND (? IS NULL OR json_extract(payload_json, '$.index') = ?)"
      )
      .get(run.id, trace.toolCallId, index ?? null, index ?? null)
    if (existing) return
    this.appendEvent(run, 'tool_trace_recorded', { trace: toStoredToolTrace(trace), index })
  }

  recordAgentStep(run: RunRow, stored: AgentStep): void {
    if (run.status !== 'running' || this.findTerminalEvent(run.id)) return
    if (this.agentEventExists(run.id, stored.index)) return
    this.appendEvent(run, 'agent_step_recorded', { step: stored })
  }

  recordTurnContext(run: RunRow, context: z.infer<typeof ContextPayloadSchema>): void {
    const accepted = this.getTurnContext(run.turn_id)
    if (accepted) {
      if (
        canonicalJson(toJsonValue({ messages: accepted })) !== canonicalJson(toJsonValue(context))
      )
        throw new Error('Turn context was already accepted with different content.')
      return
    }
    if (run.status !== 'running' || this.findTerminalEvent(run.id))
      throw new Error('Turn context cannot be accepted after the run ended.')
    this.appendEvent(run, 'turn_context_recorded', context)
  }

  markRequestStarted(run: RunRow): void {
    if (run.status !== 'running' || this.findTerminalEvent(run.id)) return
    const started = this.dependencies.database.connection
      .prepare("SELECT id FROM runtime_events WHERE run_id = ? AND kind = 'model_request_started'")
      .get(run.id)
    if (started) return
    this.appendEvent(run, 'model_request_started', {})
  }

  assertRetrySource(runId: string): void {
    const userEvent = this.dependencies.database.connection
      .prepare(
        `SELECT user_event.id
         FROM runs AS failed_run
         JOIN runs AS source_run ON source_run.turn_id = failed_run.turn_id
         JOIN runtime_events AS user_event ON user_event.run_id = source_run.id
         WHERE failed_run.id = ? AND user_event.kind = 'user_message_recorded'`
      )
      .get(runId)
    if (!userEvent) throw new Error('Failed run has no user message.')
  }

  findFailedTurn(sessionId: string, userMessage: ChatMessage): RunRow | undefined {
    const messageJson = canonicalJson(visibleMessage(userMessage))
    // SAFETY: runs.* maps to the schema-controlled runs table. The user event identifies the
    // original turn while the failed alias selects its latest failed attempt.
    const failed = this.dependencies.database.connection
      .prepare(
        `SELECT failed_runs.*
         FROM runs AS failed_runs
         JOIN turns ON turns.id = failed_runs.turn_id
         JOIN runs AS source_run ON source_run.turn_id = failed_runs.turn_id
         JOIN runtime_events AS user_event ON user_event.run_id = source_run.id
         WHERE failed_runs.session_id = ?
           AND failed_runs.status = 'failed'
           AND user_event.kind = 'user_message_recorded'
           AND json_extract(user_event.payload_json, '$.message') = json(?)
         ORDER BY turns.ordinal DESC, failed_runs.attempt DESC
         LIMIT 1`
      )
      .get(sessionId, messageJson) as RunRow | undefined
    return failed
  }

  getTranscript(sessionId: string): VisibleMessage[] {
    // SAFETY: the selected columns are fixed by this query.
    const rows = this.dependencies.database.connection
      .prepare(
        `SELECT runtime_events.run_id, runtime_events.kind, runtime_events.payload_json, runtime_events.payload_digest
         FROM runtime_events
         JOIN runs ON runs.id = runtime_events.run_id
         JOIN turns ON turns.id = runs.turn_id
         WHERE turns.session_id = ? AND runtime_events.kind IN (
           'user_message_recorded',
           'assistant_output_finalized',
           'assistant_output_snapshot',
           'agent_step_recorded',
           'tool_trace_recorded',
           'tool_trace_summary_recorded'
         )
         ORDER BY turns.ordinal, runs.attempt, runtime_events.session_sequence`
      )
      .all(sessionId) as LoadEventRow[]
    return assembleTranscript(rows)
  }

  getTurnContext(turnId: string): ProviderUserMessage[] | undefined {
    // SAFETY: the fixed query selects only the declared runtime-event payload columns.
    const row = this.dependencies.database.connection
      .prepare(
        `SELECT runtime_events.payload_json, runtime_events.payload_digest
       FROM runtime_events JOIN runs ON runs.id = runtime_events.run_id
       WHERE runs.turn_id = ? AND runtime_events.kind = 'turn_context_recorded'`
      )
      .get(turnId) as { payload_json: string; payload_digest: string } | undefined
    if (!row) return undefined
    assertPayloadDigest(row)
    return ContextPayloadSchema.parse(JSON.parse(row.payload_json)).messages
  }

  getReplayMessages(run: RunRow, throughSequence = 0): ChatProviderMessage[] {
    const runId = run.id
    // SAFETY: this fixed query returns only accepted-run identity columns. An accepted run joins
    // history where its terminal event occurred, not where its user turn was created, preserving
    // the actual conversation order after a late retry.
    const priorRuns = this.dependencies.database.connection
      .prepare(
        `WITH current_run AS (
           SELECT runs.session_id, started.session_sequence AS started_sequence
           FROM runs
           JOIN runtime_events AS started
             ON started.run_id = runs.id AND started.kind = 'run_started'
           WHERE runs.id = ?
         )
         SELECT accepted_run.id, accepted_run.turn_id
         FROM current_run
         JOIN runs AS accepted_run
           ON accepted_run.session_id = current_run.session_id
          AND accepted_run.id <> ?
         JOIN runtime_events AS terminal
           ON terminal.run_id = accepted_run.id
          AND terminal.kind IN ('run_completed', 'run_cancelled')
          AND terminal.session_sequence < current_run.started_sequence
          AND terminal.session_sequence > ?
         ORDER BY terminal.session_sequence`
      )
      .all(runId, runId, throughSequence) as Array<{ id: string; turn_id: string }>
    const messages: ChatProviderMessage[] = []
    for (const prior of priorRuns) {
      messages.push(toProviderReplayContext(this.getTurnUserMessage(prior.turn_id)))
      messages.push(...(this.getTurnContext(prior.turn_id) ?? []))
      messages.push(...this.getRunReplayEvents(prior.id))
    }
    messages.push(toProviderReplayContext(this.getTurnUserMessage(run.turn_id)))
    messages.push(...(this.getTurnContext(run.turn_id) ?? []))
    // SAFETY: the fixed query selects only the declared run identity column.
    const retryRuns = this.dependencies.database.connection
      .prepare('SELECT id FROM runs WHERE turn_id = ? AND attempt < ? ORDER BY attempt')
      .all(run.turn_id, run.attempt) as Array<{ id: string }>
    for (const retry of retryRuns) messages.push(...this.getRunReplayEvents(retry.id))
    return messages
  }

  getTurnCheckpoint(turnId: string): ContextCheckpoint | undefined {
    // SAFETY: the fixed query selects only the declared turn columns.
    const row = this.dependencies.database.connection
      .prepare('SELECT session_id, checkpoint_event_id FROM turns WHERE id = ?')
      .get(turnId) as { session_id: string; checkpoint_event_id: string | null } | undefined
    // An unpinned turn replays in full; a non-null pin delegates to getCheckpoint,
    // where a missing, corrupt, or stale checkpoint fails loudly.
    if (!row) throw new Error('Turn does not exist.')
    if (row.checkpoint_event_id === null) return undefined
    return this.getCheckpoint(row.checkpoint_event_id, row.session_id)
  }

  getCheckpoint(id: string, sessionId: string): ContextCheckpoint {
    // SAFETY: the query selects schema-owned payload columns only.
    const row = this.dependencies.database.connection
      .prepare(
        "SELECT payload_json, payload_digest FROM runtime_events WHERE id = ? AND session_id = ? AND kind = 'context_checkpoint_recorded'"
      )
      .get(id, sessionId) as { payload_json: string; payload_digest: string } | undefined
    if (!row) throw new Error('Pinned context checkpoint does not exist.')
    assertPayloadDigest(row)
    const checkpoint = ContextCheckpointSchema.parse(JSON.parse(row.payload_json))
    if (
      this.getSourceDigest(sessionId, checkpoint.coverage.throughSequence) !==
      checkpoint.sourceDigest
    )
      throw new Error('Context checkpoint source digest does not match its covered history.')
    this.assertCheckpointBoundary(sessionId, checkpoint.coverage.throughSequence)
    return checkpoint
  }

  getSourceEvents(sessionId: string, throughSequence: number): CompactionEvent[] {
    // SAFETY: the fixed SELECT returns the declared event columns.
    const rows = this.dependencies.database.connection
      .prepare(
        "SELECT id, run_id, session_sequence, kind, payload_json, payload_digest FROM runtime_events WHERE session_id = ? AND session_sequence <= ? AND kind NOT IN ('context_checkpoint_recorded', 'compaction_notice_recorded') ORDER BY session_sequence"
      )
      .all(sessionId, throughSequence) as CompactionEvent[]
    for (const row of rows) assertPayloadDigest(row)
    return rows
  }

  getSourceDigest(sessionId: string, throughSequence: number): string {
    return digest(
      canonicalJson(
        this.getSourceEvents(sessionId, throughSequence).map((row) => ({
          session_sequence: row.session_sequence,
          kind: row.kind,
          payload_digest: row.payload_digest
        }))
      )
    )
  }

  assertCheckpointBoundary(sessionId: string, throughSequence: number): RunRow {
    // SAFETY: runs.* has the schema-owned RunRow shape.
    const run = this.dependencies.database.connection
      .prepare(
        "SELECT runs.* FROM runtime_events e JOIN runs ON runs.id = e.run_id WHERE e.session_id = ? AND e.session_sequence = ? AND e.kind = 'run_completed' AND runs.status = 'completed'"
      )
      .get(sessionId, throughSequence) as RunRow | undefined
    if (!run)
      throw new CheckpointBoundaryRejected(
        'Checkpoint coverage must end at an accepted turn boundary.'
      )
    const unsafe = this.dependencies.database.connection
      .prepare(
        `SELECT e.id FROM runtime_events e JOIN runs ON runs.id = e.run_id
       WHERE e.session_id = ? AND e.session_sequence <= ? AND
       (runs.status = 'cancelled' OR NOT EXISTS (
         SELECT 1 FROM runtime_events terminal JOIN runs accepted ON accepted.id = terminal.run_id
         WHERE accepted.turn_id = runs.turn_id AND terminal.kind = 'run_completed'
         AND terminal.session_sequence <= ?)) LIMIT 1`
      )
      .get(sessionId, throughSequence, throughSequence)
    if (unsafe)
      throw new CheckpointBoundaryRejected(
        'Checkpoint boundary includes an unsettled or cancelled turn.'
      )
    return run
  }

  recordContextCheckpoint(
    run: Pick<RunRow, 'id' | 'session_id'>,
    payload: ContextCheckpoint
  ): string {
    // SAFETY: the fixed SELECT returns stored checkpoint identity and payload columns.
    const existing = this.dependencies.database.connection
      .prepare(
        "SELECT id, payload_json, payload_digest FROM runtime_events WHERE session_id = ? AND kind = 'context_checkpoint_recorded' AND json_extract(payload_json, '$.coverage.throughSequence') = ?"
      )
      .get(run.session_id, payload.coverage.throughSequence) as
      | { id: string; payload_json: string; payload_digest: string }
      | undefined
    if (existing) {
      this.getCheckpoint(existing.id, run.session_id)
      if (existing.payload_json === canonicalJson(toJsonValue(payload))) return existing.id
      throw new Error(
        'A context checkpoint already exists at this coverage boundary with different content.'
      )
    }
    return this.appendEvent(run, 'context_checkpoint_recorded', payload)
  }

  private agentEventExists(runId: string, index: number): boolean {
    return Boolean(
      this.dependencies.database.connection
        .prepare(
          "SELECT id FROM runtime_events WHERE run_id = ? AND kind = 'agent_step_recorded' AND json_extract(payload_json, '$.step.index') = ?"
        )
        .get(runId, index)
    )
  }

  private getRunReplayEvents(runId: string): ChatProviderMessage[] {
    // SAFETY: the fixed query selects only declared replay-event columns. Unlike the transcript
    // projection, replay never needs run_id or UI-trace fields — only event payloads in order.
    const rows = this.dependencies.database.connection
      .prepare(
        "SELECT payload_json, payload_digest FROM runtime_events WHERE run_id = ? AND kind = 'agent_step_recorded' ORDER BY session_sequence"
      )
      .all(runId) as Array<{
      payload_json: string
      payload_digest: string
    }>
    // SAFETY: this fixed query selects only the declared finalized-event columns.
    const finalized = this.dependencies.database.connection
      .prepare(
        "SELECT payload_json, payload_digest FROM runtime_events WHERE run_id = ? AND kind = 'assistant_output_finalized'"
      )
      .get(runId) as { payload_json: string; payload_digest: string } | undefined
    if (finalized) assertPayloadDigest(finalized)
    const finalizedMessage = finalized
      ? parseMessagePayload(finalized.payload_json).message
      : undefined
    for (const row of rows) assertPayloadDigest(row)
    return assembleReplayEvents(rows, finalizedMessage)
  }

  appendToolTraceSummary(run: Pick<RunRow, 'id' | 'session_id'>): void {
    // SAFETY: this fixed query selects only the two declared runtime_events columns.
    const rows = this.dependencies.database.connection
      .prepare(
        "SELECT payload_json, payload_digest FROM runtime_events WHERE run_id = ? AND kind = 'tool_trace_recorded' ORDER BY session_sequence"
      )
      .all(run.id) as Array<{ payload_json: string; payload_digest: string }>
    const traces = rows.map((row) => {
      assertPayloadDigest(row)
      return parseToolTracePayload(row.payload_json).trace
    })
    const succeeded = traces.filter((trace) => trace.status === 'completed').length
    const failed = traces.length - succeeded
    const names = [...new Set(traces.map((trace) => toolLabel(trace.toolName)))]
    const summary =
      traces.length === 0
        ? 'No tools used.'
        : `${names.join(', ')} · ${succeeded} completed${failed ? `, ${failed} failed` : ''}.`
    this.appendEvent(run, 'tool_trace_summary_recorded', {
      summary: { total: traces.length, succeeded, failed, summary }
    })
  }

  findRunByRequestId(sessionId: string, requestId: string): RunRow | undefined {
    // SAFETY: runs.* maps to the schema-controlled runs table.
    return this.dependencies.database.connection
      .prepare(
        "SELECT runs.* FROM runtime_events JOIN runs ON runs.id = runtime_events.run_id WHERE runtime_events.session_id = ? AND runtime_events.kind = 'run_started' AND json_extract(runtime_events.payload_json, '$.requestId') = ?"
      )
      .get(sessionId, requestId) as RunRow | undefined
  }

  getTurnUserMessage(turnId: string): VisibleMessage {
    // SAFETY: the source attempt is the only run in a turn that records the user message.
    const row = this.dependencies.database.connection
      .prepare(
        `SELECT runtime_events.payload_json, runtime_events.payload_digest
         FROM runtime_events
         JOIN runs ON runs.id = runtime_events.run_id
         WHERE runs.turn_id = ? AND runtime_events.kind = 'user_message_recorded'`
      )
      .get(turnId) as { payload_json: string; payload_digest: string } | undefined
    if (!row) throw new Error('Turn has no user message.')
    assertPayloadDigest(row)
    return parseMessagePayload(row.payload_json).message
  }

  getExecutionProfile(runId: string): ExecutionProfileSnapshot {
    // SAFETY: every run starts by appending exactly one run_started event.
    const row = this.dependencies.database.connection
      .prepare(
        "SELECT payload_json, payload_digest FROM runtime_events WHERE run_id = ? AND kind = 'run_started'"
      )
      .get(runId) as { payload_json: string; payload_digest: string } | undefined
    if (!row) throw new Error('Run has no start event.')
    assertPayloadDigest(row)
    // SAFETY: run_started payloads are serialized from RuntimeEventPayloads by appendEvent.
    return (JSON.parse(row.payload_json) as RuntimeEventPayloads['run_started']).profile
  }

  shouldGenerateTitle(run: RunRow): boolean {
    if (run.attempt !== 1) return false
    // SAFETY: the aggregate query always returns one boolean-compatible numeric row.
    const row = this.dependencies.database.connection
      .prepare(
        `SELECT NOT EXISTS (
           SELECT 1
           FROM runtime_events AS terminal
           JOIN runtime_events AS started
             ON started.run_id = ? AND started.kind = 'run_started'
           WHERE terminal.session_id = ?
             AND terminal.kind IN ('run_completed', 'run_cancelled')
             AND terminal.session_sequence < started.session_sequence
         ) AS should_generate_title`
      )
      .get(run.id, run.session_id) as { should_generate_title: number }
    return Boolean(row.should_generate_title)
  }

  findTerminalEvent(runId: string): { id: string } | undefined {
    // SAFETY: the selected id column is defined by the migration.
    return this.dependencies.database.connection
      .prepare(
        "SELECT id FROM runtime_events WHERE run_id = ? AND kind IN ('run_completed', 'run_failed', 'run_cancelled')"
      )
      .get(runId) as { id: string } | undefined
  }

  appendEvent<Kind extends RuntimeEventKind>(
    run: Pick<RunRow, 'id' | 'session_id'>,
    kind: Kind,
    payload: RuntimeEventPayloads[Kind]
  ): string {
    const payloadJson = canonicalJson(toJsonValue(payload))
    const id = this.dependencies.createId()
    // appendEvent is only called inside an IMMEDIATE transaction, so sequence allocation and the
    // insert are atomic even though the next value is derived from the existing session log.
    this.dependencies.database.connection
      .prepare(
        `INSERT INTO runtime_events (
           id, session_id, run_id, session_sequence,
           kind, payload_json, payload_digest, created_at
         )
         SELECT ?, ?, ?, COALESCE(MAX(session_sequence), 0) + 1, ?, ?, ?, ?
         FROM runtime_events
         WHERE session_id = ?`
      )
      .run(
        id,
        run.session_id,
        run.id,
        kind,
        payloadJson,
        digest(payloadJson),
        this.dependencies.now(),
        run.session_id
      )
    return id
  }
}

function toJsonValue(value: RuntimeEventPayloads[RuntimeEventKind]): JsonValue {
  return z.json().parse(JSON.parse(JSON.stringify(value)))
}
function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (Object.prototype.toString.call(value) === '[object Object]') {
    // SAFETY: JsonValue permits objects only through JsonObject.
    const object = value as JsonObject
    return `{${Object.entries(object)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function parseTurnContext(messages: ProviderUserMessage[]): z.infer<typeof ContextPayloadSchema> {
  return ContextPayloadSchema.parse({ messages })
}
function assertPayloadDigest(row: { payload_json: string; payload_digest: string }): void {
  if (digest(row.payload_json) !== row.payload_digest)
    throw new Error('Runtime event payload digest does not match its stored value.')
}
function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export type { CompactionEvent, CompactionNotice, ContextCheckpoint, ProviderUserMessage, RunRow }
export {
  assertPayloadDigest,
  CheckpointBoundaryRejected,
  CompactionNoticeSchema,
  ContextCheckpointSchema,
  canonicalJson,
  parseTurnContext,
  SessionEventLog
}
