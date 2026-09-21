import { createHash } from 'node:crypto'
import * as z from 'zod'

import type { ChatProviderMessage, ChatProviderToolResultPart } from '@mico/ai-providers'

import {
  ChatDocumentPartSchema,
  ChatMessageRoleSchema,
  ChatReasoningPartSchema,
  ChatToolTracePresentationSchema,
  ChatToolTracePartSchema,
  type ChatMessage,
  type ChatToolTraceInput,
  type ChatToolTracePresentation,
  type ChatToolTracePart
} from '@shared/data/schemas/chat'
import { toolLabel } from '@shared/ai/tool-presentation'
import type {
  ExecutionProfileSnapshot,
  PersistedSession,
  SessionSummary
} from '@shared/data/schemas/session'
import { SessionDatabase } from '../../data/session-database'
import type { ToolExecutionTrace } from '../tools/tool-contract'

type VisibleMessage = {
  role: ChatMessage['role']
  parts: Array<
    | { type: 'text'; text: string }
    | { type: 'document'; name: string; text: string }
    | { type: 'reasoning'; text: string }
    | ChatToolTracePart
  >
  metadata?: { completionState?: 'complete' | 'stopped' }
}
const VisibleMessageSchema: z.ZodType<VisibleMessage> = z.object({
  role: ChatMessageRoleSchema,
  parts: z.array(
    z.union([
      z.object({ type: z.literal('text'), text: z.string() }),
      ChatDocumentPartSchema,
      ChatReasoningPartSchema,
      ChatToolTracePartSchema
    ])
  ),
  metadata: z.object({ completionState: z.enum(['complete', 'stopped']).optional() }).optional()
})
const MessagePayloadSchema = z.object({ message: VisibleMessageSchema })
type RuntimeEventPayloads = {
  run_started: {
    attempt: number
    profile: ExecutionProfileSnapshot
    requestId: string
  }
  user_message_recorded: { message: VisibleMessage }
  model_request_started: Record<string, never>
  assistant_output_finalized: { message: VisibleMessage }
  tool_trace_recorded: { trace: StoredToolTrace }
  tool_trace_summary_recorded: { summary: ToolTraceSummary }
  agent_step_recorded: { step: AgentStep }
  run_failed: { code: string; message: string }
  run_cancelled: Record<string, never>
  run_completed: Record<string, never>
}
type RuntimeEventKind = keyof RuntimeEventPayloads
type JsonValue = boolean | JsonObject | JsonValue[] | null | number | string
type JsonObject = { [key: string]: JsonValue }
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
type ToolTraceSummary = {
  total: number
  succeeded: number
  failed: number
  summary: string
}
type AgentStep = {
  index: number
  assistant: Extract<ChatProviderMessage, { role: 'assistant' }>
  toolResults: ChatProviderToolResultPart[]
}
type StartedRun = {
  runId: string
  turnId: string
  shouldGenerateTitle: boolean
  profile: ExecutionProfileSnapshot
}
type StartTurnInput = {
  sessionId: string
  requestId: string
  userMessage: ChatMessage
  profile: ExecutionProfileSnapshot
}
type RunOutcome =
  | { status: 'completed'; assistant: ChatMessage }
  | { status: 'failed'; failure: { code: string; message: string } }
  | { status: 'cancelled'; assistant?: ChatMessage }
type SessionRuntimeServiceDependencies = {
  createId?: () => string
  database: SessionDatabase
  now?: () => number
}

const defaultDependencies = {
  createId: () => crypto.randomUUID(),
  now: () => Date.now()
}

class SessionRuntimeService {
  private readonly dependencies: Required<SessionRuntimeServiceDependencies>

  constructor(dependencies: SessionRuntimeServiceDependencies) {
    this.dependencies = { ...defaultDependencies, ...dependencies }
  }

  createSession({
    title,
    defaultProfile,
    projectId = null,
    cwd = null
  }: {
    title: string
    defaultProfile: ExecutionProfileSnapshot | null
    projectId?: string | null
    cwd?: string | null
  }): SessionSummary {
    if ((projectId === null) !== (cwd === null))
      throw new Error('Project sessions require a current working directory.')
    const id = this.dependencies.createId()
    const now = this.dependencies.now()
    this.dependencies.database.connection
      .prepare(
        `INSERT INTO sessions (id, title, project_id, cwd, default_execution_profile_json, created_at, updated_at, last_activity_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        title,
        projectId,
        cwd,
        defaultProfile ? canonicalJson(defaultProfile) : null,
        now,
        now,
        now
      )
    return {
      id,
      title,
      projectId,
      cwd,
      defaultProfile,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now
    }
  }

  listSessions(): SessionSummary[] {
    return this.dependencies.database.connection
      .prepare('SELECT * FROM sessions ORDER BY last_activity_at DESC')
      .all()
      .map((row) => {
        // SAFETY: rows are produced by the schema-controlled sessions table.
        return toSessionSummary(row as SessionRow)
      })
  }

  loadSession(sessionId: string): PersistedSession {
    const session = this.findSession(sessionId)
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
           'agent_step_recorded',
           'tool_trace_recorded',
           'tool_trace_summary_recorded'
         )
         ORDER BY turns.ordinal, runs.attempt, runtime_events.session_sequence`
      )
      .all(sessionId) as LoadEventRow[]
    for (const row of rows) this.assertPayloadDigest(row)
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
    return {
      ...toSessionSummary(session),
      messages: rows.flatMap((row) => {
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
  }

  recordToolTrace(runId: string, trace: ToolExecutionTrace): void {
    this.dependencies.database.transaction(() => {
      const run = this.getRunRow(runId)
      if (run.status !== 'running' || this.findTerminalEvent(runId)) return
      const existing = this.dependencies.database.connection
        .prepare(
          "SELECT id FROM runtime_events WHERE run_id = ? AND kind = 'tool_trace_recorded' AND json_extract(payload_json, '$.trace.toolCallId') = ?"
        )
        .get(runId, trace.toolCallId)
      if (existing) return
      this.appendEvent(run, 'tool_trace_recorded', { trace: toStoredToolTrace(trace) })
    })
  }

  recordAgentStep(runId: string, step: AgentStep): void {
    const stored = sanitizeAgentStep(step)
    this.dependencies.database.transaction(() => {
      const run = this.getRunRow(runId)
      if (run.status !== 'running' || this.findTerminalEvent(runId)) return
      if (this.agentEventExists(runId, stored.index)) return
      this.appendEvent(run, 'agent_step_recorded', { step: stored })
    })
  }

  getDefaultProfile(sessionId: string): ExecutionProfileSnapshot | null {
    return toSessionSummary(this.findSession(sessionId)).defaultProfile
  }

  getReplayMessages(runId: string): ChatProviderMessage[] {
    const run = this.getRunRow(runId)
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
         ORDER BY terminal.session_sequence`
      )
      .all(runId, runId) as Array<{ id: string; turn_id: string }>
    const messages: ChatProviderMessage[] = []
    for (const prior of priorRuns) {
      messages.push(toProviderContextMessage(this.getTurnUserMessage(prior.turn_id)))
      const events = this.getRunReplayEvents(prior.id)
      if (events.length) messages.push(...events)
      else {
        // SAFETY: the fixed query selects the two declared runtime-event columns.
        const finalized = this.dependencies.database.connection
          .prepare(
            "SELECT payload_json, payload_digest FROM runtime_events WHERE run_id = ? AND kind = 'assistant_output_finalized'"
          )
          .get(prior.id) as { payload_json: string; payload_digest: string } | undefined
        if (finalized) {
          this.assertPayloadDigest(finalized)
          messages.push(
            toProviderContextMessage(parseMessagePayload(finalized.payload_json).message)
          )
        }
      }
    }
    messages.push(toProviderContextMessage(this.getTurnUserMessage(run.turn_id)))
    // SAFETY: the fixed query selects only the declared run identity column.
    const retryRuns = this.dependencies.database.connection
      .prepare('SELECT id FROM runs WHERE turn_id = ? AND attempt < ? ORDER BY attempt')
      .all(run.turn_id, run.attempt) as Array<{ id: string }>
    for (const retry of retryRuns) messages.push(...this.getRunReplayEvents(retry.id))
    return messages
  }

  private getRunReplayEvents(runId: string): ChatProviderMessage[] {
    // SAFETY: the fixed query selects only declared replay-event columns.
    const rows = this.dependencies.database.connection
      .prepare(
        "SELECT payload_json, payload_digest FROM runtime_events WHERE run_id = ? AND kind = 'agent_step_recorded' ORDER BY session_sequence"
      )
      .all(runId) as Array<{
      payload_json: string
      payload_digest: string
    }>
    const messages: ChatProviderMessage[] = []
    for (const row of rows) {
      this.assertPayloadDigest(row)
      const step = parseAgentStepPayload(row.payload_json).step
      messages.push(toReplayAssistant(step.assistant), { role: 'tool', parts: step.toolResults })
    }
    return messages
  }

  renameSession(sessionId: string, title: string): SessionSummary {
    const now = this.dependencies.now()
    const result = this.dependencies.database.connection
      .prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, now, sessionId)
    if (!result.changes) throw new Error('Session does not exist.')
    return toSessionSummary(this.findSession(sessionId))
  }

  updateDefaultProfile(
    sessionId: string,
    defaultProfile: ExecutionProfileSnapshot
  ): SessionSummary {
    const now = this.dependencies.now()
    const result = this.dependencies.database.connection
      .prepare(
        'UPDATE sessions SET default_execution_profile_json = ?, updated_at = ? WHERE id = ?'
      )
      .run(canonicalJson(defaultProfile), now, sessionId)
    if (!result.changes) throw new Error('Session does not exist.')
    return toSessionSummary(this.findSession(sessionId))
  }

  renameSessionIfCurrentTitle(
    sessionId: string,
    currentTitle: string,
    title: string
  ): SessionSummary | null {
    const now = this.dependencies.now()
    const result = this.dependencies.database.connection
      .prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ? AND title = ?')
      .run(title, now, sessionId, currentTitle)
    return result.changes ? toSessionSummary(this.findSession(sessionId)) : null
  }

  deleteSession(sessionId: string): void {
    this.dependencies.database.transaction(() => {
      const active = this.dependencies.database.connection
        .prepare("SELECT id FROM runs WHERE session_id = ? AND status = 'running'")
        .get(sessionId)
      if (active) throw new Error('Session has an active run.')
      const result = this.dependencies.database.connection
        .prepare('DELETE FROM sessions WHERE id = ?')
        .run(sessionId)
      if (!result.changes) throw new Error('Session does not exist.')
    })
  }

  startTurn(input: StartTurnInput): StartedRun {
    return this.dependencies.database.transaction(() => {
      const existing = this.findRunByRequestId(input.sessionId, input.requestId)
      if (existing) {
        if (existing.attempt !== 1)
          throw new Error('Request ID was already used to retry an existing turn.')
        this.assertStartTurnReplay(existing, input)
        return this.toStartedRun(existing)
      }
      this.findSession(input.sessionId)
      const active = this.dependencies.database.connection
        .prepare("SELECT id FROM runs WHERE session_id = ? AND status = 'running'")
        .get(input.sessionId)
      if (active) throw new Error('Session already has an active run.')

      const now = this.dependencies.now()
      const turnId = this.dependencies.createId()
      const runId = this.dependencies.createId()
      const run: RunRow = {
        id: runId,
        session_id: input.sessionId,
        turn_id: turnId,
        attempt: 1,
        status: 'running'
      }
      const turnOrdinal = this.nextTurnOrdinal(input.sessionId)
      this.dependencies.database.connection
        .prepare('INSERT INTO turns (id, session_id, ordinal, created_at) VALUES (?, ?, ?, ?)')
        .run(turnId, input.sessionId, turnOrdinal, now)
      this.dependencies.database.connection
        .prepare(
          `INSERT INTO runs (id, session_id, turn_id, attempt, status, started_at, finished_at, failure_json)
           VALUES (?, ?, ?, 1, 'running', ?, NULL, NULL)`
        )
        .run(runId, input.sessionId, turnId, now)
      this.appendEvent(run, 'run_started', {
        attempt: 1,
        profile: input.profile,
        requestId: input.requestId
      })
      this.appendEvent(run, 'user_message_recorded', {
        message: visibleMessage(input.userMessage)
      })
      this.touchSession(input.sessionId)
      return this.toStartedRun(run)
    })
  }

  markRequestStarted(runId: string): void {
    this.dependencies.database.transaction(() => {
      const run = this.getRunRow(runId)
      if (run.status !== 'running' || this.findTerminalEvent(runId)) return
      const started = this.dependencies.database.connection
        .prepare(
          "SELECT id FROM runtime_events WHERE run_id = ? AND kind = 'model_request_started'"
        )
        .get(runId)
      if (started) return
      this.appendEvent(run, 'model_request_started', {})
    })
  }

  finishRun(runId: string, outcome: RunOutcome): void {
    switch (outcome.status) {
      case 'completed':
        this.completeTerminalRun(runId, 'completed', 'run_completed', (run) =>
          this.appendEvent(run, 'assistant_output_finalized', {
            message: visibleMessage(outcome.assistant)
          })
        )
        return
      case 'failed':
        this.completeTerminalRun(runId, 'failed', 'run_failed', () => undefined, outcome.failure)
        return
      case 'cancelled':
        this.completeTerminalRun(runId, 'cancelled', 'run_cancelled', (run) =>
          outcome.assistant
            ? this.appendEvent(run, 'assistant_output_finalized', {
                message: visibleMessage(outcome.assistant)
              })
            : undefined
        )
    }
  }

  private retryRun({
    failedRunId,
    requestId
  }: {
    failedRunId: string
    requestId: string
  }): StartedRun {
    const failed = this.getRunRow(failedRunId)
    if (failed.status !== 'failed') throw new Error('Only failed runs can be retried.')
    return this.dependencies.database.transaction(() => {
      const userEvent = this.dependencies.database.connection
        .prepare(
          "SELECT id FROM runtime_events WHERE run_id = ? AND kind = 'user_message_recorded'"
        )
        .get(failedRunId)
      if (!userEvent) throw new Error('Failed run has no user message.')
      const runId = this.dependencies.createId()
      const now = this.dependencies.now()
      // SAFETY: this aggregate query always returns one numeric row.
      const attempt =
        (
          this.dependencies.database.connection
            .prepare('SELECT COALESCE(MAX(attempt), 0) AS attempt FROM runs WHERE turn_id = ?')
            .get(failed.turn_id) as { attempt: number }
        ).attempt + 1
      const profile = this.getExecutionProfile(failed.id)
      const run: RunRow = {
        id: runId,
        session_id: failed.session_id,
        turn_id: failed.turn_id,
        attempt,
        status: 'running'
      }
      this.dependencies.database.connection
        .prepare(`INSERT INTO runs (id, session_id, turn_id, attempt, status, started_at, finished_at, failure_json)
        VALUES (?, ?, ?, ?, 'running', ?, NULL, NULL)`)
        .run(runId, failed.session_id, failed.turn_id, attempt, now)
      this.appendEvent(run, 'run_started', {
        attempt,
        profile,
        requestId
      })
      this.touchSession(failed.session_id)
      return this.toStartedRun(run)
    })
  }

  retryTurn({
    sessionId,
    requestId,
    userMessage
  }: {
    sessionId: string
    requestId: string
    userMessage: ChatMessage
  }): StartedRun {
    const existing = this.findRunByRequestId(sessionId, requestId)
    if (existing) {
      if (existing.attempt === 1)
        throw new Error('Request ID was already used to start a new turn.')
      this.assertRetryReplay(existing, userMessage)
      return this.toStartedRun(existing)
    }

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
    if (!failed) throw new Error('Failed turn does not exist for this user message.')
    return this.retryRun({ failedRunId: failed.id, requestId })
  }

  recoverInterruptedRuns(): number {
    // SAFETY: runs.* maps to the schema-controlled runs table.
    const runningRuns = this.dependencies.database.connection
      .prepare("SELECT * FROM runs WHERE status = 'running'")
      .all() as RunRow[]
    for (const run of runningRuns) {
      this.dependencies.database.transaction(() => {
        this.appendEvent(run, 'run_failed', {
          code: 'process_interrupted',
          message: 'The app closed while this run was active.'
        })
        this.dependencies.database.connection
          .prepare(
            "UPDATE runs SET status = 'interrupted', finished_at = ?, failure_json = ? WHERE id = ?"
          )
          .run(
            this.dependencies.now(),
            canonicalJson({
              code: 'process_interrupted',
              message: 'The app closed while this run was active.'
            }),
            run.id
          )
      })
    }
    return runningRuns.length
  }

  private completeTerminalRun(
    runId: string,
    status: 'completed' | 'failed' | 'cancelled',
    event: 'run_completed' | 'run_failed' | 'run_cancelled',
    beforeEvent: (run: RunRow) => void,
    failure?: { code: string; message: string }
  ): void {
    this.dependencies.database.transaction(() => {
      const run = this.getRunRow(runId)
      if (run.status === status && this.findTerminalEvent(runId)) return
      if (run.status !== 'running')
        throw new Error('Run already has a contradictory terminal state.')
      beforeEvent(run)
      this.appendToolTraceSummary(run)
      this.appendEvent(run, event, failure ?? {})
      this.dependencies.database.connection
        .prepare('UPDATE runs SET status = ?, finished_at = ?, failure_json = ? WHERE id = ?')
        .run(status, this.dependencies.now(), failure ? canonicalJson(failure) : null, runId)
    })
  }

  private appendEvent<Kind extends RuntimeEventKind>(
    run: Pick<RunRow, 'id' | 'session_id'>,
    kind: Kind,
    payload: RuntimeEventPayloads[Kind]
  ): void {
    const payloadJson = canonicalJson(toJsonValue(payload))
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
        this.dependencies.createId(),
        run.session_id,
        run.id,
        kind,
        payloadJson,
        digest(payloadJson),
        this.dependencies.now(),
        run.session_id
      )
  }

  private appendToolTraceSummary(run: Pick<RunRow, 'id' | 'session_id'>): void {
    // SAFETY: this fixed query selects only the two declared runtime_events columns.
    const rows = this.dependencies.database.connection
      .prepare(
        "SELECT payload_json, payload_digest FROM runtime_events WHERE run_id = ? AND kind = 'tool_trace_recorded' ORDER BY session_sequence"
      )
      .all(run.id) as Array<{ payload_json: string; payload_digest: string }>
    const traces = rows.map((row) => {
      this.assertPayloadDigest(row)
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

  private findRunByRequestId(sessionId: string, requestId: string): RunRow | undefined {
    // SAFETY: runs.* maps to the schema-controlled runs table.
    return this.dependencies.database.connection
      .prepare(
        "SELECT runs.* FROM runtime_events JOIN runs ON runs.id = runtime_events.run_id WHERE runtime_events.session_id = ? AND runtime_events.kind = 'run_started' AND json_extract(runtime_events.payload_json, '$.requestId') = ?"
      )
      .get(sessionId, requestId) as RunRow | undefined
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

  private assertStartTurnReplay(run: RunRow, input: StartTurnInput): void {
    const storedMessage = this.getTurnUserMessage(run.turn_id)
    const storedProfile = this.getExecutionProfile(run.id)
    if (
      canonicalJson(storedMessage) !== canonicalJson(visibleMessage(input.userMessage)) ||
      canonicalJson(storedProfile) !== canonicalJson(input.profile)
    ) {
      throw new Error('Request ID was already used with different turn input.')
    }
  }

  private assertRetryReplay(run: RunRow, userMessage: ChatMessage): void {
    if (
      canonicalJson(this.getTurnUserMessage(run.turn_id)) !==
      canonicalJson(visibleMessage(userMessage))
    ) {
      throw new Error('Request ID was already used with a different user message.')
    }
  }

  private getTurnUserMessage(turnId: string): VisibleMessage {
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
    this.assertPayloadDigest(row)
    return parseMessagePayload(row.payload_json).message
  }

  private getExecutionProfile(runId: string): ExecutionProfileSnapshot {
    // SAFETY: every run starts by appending exactly one run_started event.
    const row = this.dependencies.database.connection
      .prepare(
        "SELECT payload_json, payload_digest FROM runtime_events WHERE run_id = ? AND kind = 'run_started'"
      )
      .get(runId) as { payload_json: string; payload_digest: string } | undefined
    if (!row) throw new Error('Run has no start event.')
    this.assertPayloadDigest(row)
    // SAFETY: run_started payloads are serialized from RuntimeEventPayloads by appendEvent.
    return (JSON.parse(row.payload_json) as RuntimeEventPayloads['run_started']).profile
  }

  private assertPayloadDigest(row: { payload_json: string; payload_digest: string }): void {
    if (digest(row.payload_json) !== row.payload_digest)
      throw new Error('Runtime event payload digest does not match its stored value.')
  }

  private toStartedRun(run: RunRow): StartedRun {
    return {
      runId: run.id,
      turnId: run.turn_id,
      shouldGenerateTitle: this.shouldGenerateTitle(run),
      profile: this.getExecutionProfile(run.id)
    }
  }

  private shouldGenerateTitle(run: RunRow): boolean {
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
  private findSession(id: string): SessionRow {
    // SAFETY: sessions.* maps to the schema-controlled sessions table.
    const row = this.dependencies.database.connection
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(id) as SessionRow | undefined
    if (!row) throw new Error('Session does not exist.')
    return row
  }
  private getRunRow(id: string): RunRow {
    // SAFETY: runs.* maps to the schema-controlled runs table.
    const row = this.dependencies.database.connection
      .prepare('SELECT * FROM runs WHERE id = ?')
      .get(id) as RunRow | undefined
    if (!row) throw new Error('Run does not exist.')
    return row
  }
  private findTerminalEvent(runId: string): { id: string } | undefined {
    // SAFETY: the selected id column is defined by the migration.
    return this.dependencies.database.connection
      .prepare(
        "SELECT id FROM runtime_events WHERE run_id = ? AND kind IN ('run_completed', 'run_failed', 'run_cancelled')"
      )
      .get(runId) as { id: string } | undefined
  }
  private nextTurnOrdinal(sessionId: string): number {
    // SAFETY: the aggregate query always returns one numeric row.
    const row = this.dependencies.database.connection
      .prepare('SELECT COALESCE(MAX(ordinal), 0) AS ordinal FROM turns WHERE session_id = ?')
      .get(sessionId) as { ordinal: number }
    return row.ordinal + 1
  }
  private touchSession(id: string): void {
    const now = this.dependencies.now()
    this.dependencies.database.connection
      .prepare('UPDATE sessions SET updated_at = ?, last_activity_at = ? WHERE id = ?')
      .run(now, now, id)
  }
}

/** Complete `sessions` table row selected by `findSession` and session-list queries. */
type SessionRow = {
  id: string
  title: string
  project_id: string | null
  cwd: string | null
  default_execution_profile_json: string | null
  created_at: number
  updated_at: number
  last_activity_at: number
}
/** Complete `runs` table row; runtime methods need its persistence identity and lifecycle state. */
type RunRow = {
  id: string
  session_id: string
  turn_id: string
  attempt: number
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
}
/**
 * Narrow projection used only by `loadSession`.
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
/**
 * Narrow projection used only by `getReplayMessages`.
 *
 * Unlike `LoadEventRow`, replay needs `turn_id` to distinguish retry events
 * from accepted earlier turns; it never needs `run_id` or UI-trace fields.
 */
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
    toolResults: z.array(z.custom<ChatProviderToolResultPart>()).min(1)
  })
})
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
type TruncatedToolPresentationText = { isTruncated: boolean; text: string }
function toSessionSummary(row: SessionRow): SessionSummary {
  // SAFETY: default profiles are serialized by canonicalJson from an ExecutionProfileSnapshot.
  return {
    id: row.id,
    title: row.title,
    projectId: row.project_id,
    cwd: row.cwd,
    defaultProfile: row.default_execution_profile_json
      ? (JSON.parse(row.default_execution_profile_json) as ExecutionProfileSnapshot)
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at
  }
}
function visibleMessage(message: ChatMessage): VisibleMessage {
  const parts: VisibleMessage['parts'] = []
  for (const part of message.parts) {
    if (part.type === 'text') parts.push({ type: 'text', text: part.text })
    else if (part.type === 'document') parts.push(part)
    else if (part.type === 'reasoning') parts.push({ type: 'reasoning', text: part.text })
    else if (part.type === 'tool-trace') parts.push(part)
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
function parseToolTracePayload(value: string): { trace: StoredToolTrace } {
  return ToolTracePayloadSchema.parse(JSON.parse(value))
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
function toProviderContextMessage(message: ChatMessage): ChatProviderMessage {
  return {
    role: message.role,
    parts: message.parts.flatMap((part) => {
      if (part.type === 'text') return [{ type: 'text' as const, text: part.text }]
      if (part.type === 'document')
        return [
          {
            type: 'text' as const,
            text: `<document name="${part.name}">\n${part.text}\n</document>`
          }
        ]
      return []
    })
  }
}
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
function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
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

export { SessionRuntimeService, toDisplayToolTrace }
export type {
  ExecutionProfileSnapshot,
  PersistedSession,
  SessionRuntimeServiceDependencies,
  SessionSummary,
  StartedRun
}
