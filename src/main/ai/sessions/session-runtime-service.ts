import type { ChatProviderMessage } from '@mico/ai-providers'
import type { TurnFailure } from '@shared/ai/turn-failure'
import type { ChatMessage } from '@shared/data/schemas/chat'
import type {
  ExecutionProfileSnapshot,
  PersistedSession,
  SessionSummary
} from '@shared/data/schemas/session'
import { type SessionRecovery, SessionRecoverySchema } from '@shared/data/schemas/session'
import { SessionDatabase } from '../../data/session-database'
import type { ToolExecutionTrace } from '../tools/tool-contract'
import {
  CheckpointBoundaryRejected,
  ContextCheckpointSchema,
  canonicalJson,
  type ProviderUserMessage,
  parseTurnContext,
  type RunRow,
  SessionEventLog
} from './session-event-log'
import { getSessionReplay } from './session-replay'
import {
  type ModelStepAccepted,
  SessionToolJournal,
  type ToolExecutionSettled,
  type ToolExecutionStarted
} from './session-tool-journal'
import { type AgentStep, sanitizeAgentStep, visibleMessage } from './session-transcript'

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
  | { status: 'failed'; failure: TurnFailure; assistant?: ChatMessage }
  | { status: 'cancelled'; assistant?: ChatMessage }
/**
 * One accepted run, scoped to the turn executor's needs. The handle hides the
 * runtime event log: callers record steps and traces and settle the run
 * without knowing event kinds, ordering rules, or payload digests.
 */
type TurnRunHandle = {
  runId: string
  profile: ExecutionProfileSnapshot
  shouldGenerateTitle: boolean
  cwd: string | null
  replayMessages: ChatProviderMessage[]
  /** Accepted model-only context snapshot; undefined means not yet accepted. Retries reuse it. */
  contextMessages: ProviderUserMessage[] | undefined
  recordContext: (messages: ProviderUserMessage[]) => void
  recordStep: (step: AgentStep) => void
  recordTrace: (trace: ToolExecutionTrace) => void
  complete: (assistant: ChatMessage) => void
  recordModelStep: (step: ModelStepAccepted) => void
  recordToolExecutionStarted: (execution: ToolExecutionStarted) => void
  recordToolExecutionSettled: (execution: ToolExecutionSettled) => void
  fail: (failure: TurnFailure, assistant?: ChatMessage) => void
  cancel: (assistant?: ChatMessage) => void
}
type SessionRuntimeServiceDependencies = {
  createId?: () => string
  database: SessionDatabase
  now?: () => number
}

const defaultDependencies = {
  createId: () => crypto.randomUUID(),
  now: () => Date.now()
}

/**
 * The single recovery gate copy: unknown tool outcomes block retry, compaction
 * acceptance, and every consumer that surfaces the reason to the user.
 */
const UNKNOWN_TOOL_OUTCOME_MESSAGE =
  'A tool execution outcome is unknown. Inspect the workspace files and command results before starting a new request.'

class SessionRuntimeService {
  private readonly dependencies: Required<SessionRuntimeServiceDependencies>
  private readonly eventLog: SessionEventLog
  private readonly journal: SessionToolJournal

  constructor(dependencies: SessionRuntimeServiceDependencies) {
    this.dependencies = { ...defaultDependencies, ...dependencies }
    this.eventLog = new SessionEventLog(this.dependencies)
    this.journal = new SessionToolJournal(dependencies.database, this.eventLog)
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
    return {
      ...toSessionSummary(session),
      messages: this.eventLog.getTranscript(sessionId),
      recovery: this.getRecovery(sessionId)
    }
  }

  recordToolTrace(runId: string, trace: ToolExecutionTrace): void {
    this.dependencies.database.transaction(() => {
      this.eventLog.recordToolTrace(this.getRunRow(runId), trace)
    })
  }

  recordAgentStep(runId: string, step: AgentStep): void {
    const stored = sanitizeAgentStep(step)
    this.dependencies.database.transaction(() => {
      this.eventLog.recordAgentStep(this.getRunRow(runId), stored)
    })
  }

  private recordTurnContext(runId: string, messages: ProviderUserMessage[]): void {
    const context = parseTurnContext(messages)
    this.dependencies.database.transaction(() => {
      this.eventLog.recordTurnContext(this.getRunRow(runId), context)
    })
  }

  markRequestStarted(runId: string): void {
    this.dependencies.database.transaction(() => {
      this.eventLog.markRequestStarted(this.getRunRow(runId))
    })
  }

  getDefaultProfile(sessionId: string): ExecutionProfileSnapshot | null {
    return toSessionSummary(this.findSession(sessionId)).defaultProfile
  }

  getReplayMessages(runId: string): ChatProviderMessage[] {
    return getSessionReplay(
      this.dependencies.database,
      this.eventLog,
      this.journal,
      this.getRunRow(runId)
    )
  }

  getCompactionSource(sessionId: string): {
    throughSequence: number
    sourceDigest: string
    events: import('./session-event-log').CompactionEvent[]
    messages: ChatProviderMessage[]
  } | null {
    this.findSession(sessionId)
    // SAFETY: the query selects the declared boundary columns.
    const boundaries = this.dependencies.database.connection
      .prepare(
        "SELECT session_sequence, run_id FROM runtime_events WHERE session_id = ? AND kind = 'run_completed' ORDER BY session_sequence DESC"
      )
      .all(sessionId) as { session_sequence: number; run_id: string }[]
    for (const boundary of boundaries) {
      try {
        this.eventLog.assertCheckpointBoundary(sessionId, boundary.session_sequence)
      } catch (error) {
        if (!(error instanceof CheckpointBoundaryRejected)) throw error
        continue
      }
      const run = this.getRunRow(boundary.run_id)
      // The terminal run's original pin is authoritative, including when preparing
      // a repeated compaction. Append that turn's accepted attempt history once.
      const messages = [...this.getReplayMessages(run.id), ...this.journal.replay(run.id)]
      return {
        throughSequence: boundary.session_sequence,
        sourceDigest: this.eventLog.getSourceDigest(sessionId, boundary.session_sequence),
        events: this.eventLog.getSourceEvents(sessionId, boundary.session_sequence),
        messages
      }
    }
    return null
  }

  acceptContextCheckpoint(input: {
    sessionId: string
    summary: string
    coverage: { throughSequence: number }
    sourceDigest: string
  }): { checkpointEventId: string } {
    const payload = ContextCheckpointSchema.parse({
      trigger: 'manual',
      summary: input.summary,
      coverage: input.coverage,
      sourceDigest: input.sourceDigest
    })
    return this.dependencies.database.transaction(() => {
      this.findSession(input.sessionId)
      const active = this.dependencies.database.connection
        .prepare("SELECT id FROM runs WHERE session_id = ? AND status = 'running'")
        .get(input.sessionId)
      if (active) throw new Error('Session already has an active run.')
      const recovery = this.getRecovery(input.sessionId)
      if (recovery && !recovery.canRetry) throw new Error(recovery.blockedReason)
      const run = this.eventLog.assertCheckpointBoundary(
        input.sessionId,
        payload.coverage.throughSequence
      )
      if (
        this.eventLog.getSourceDigest(input.sessionId, payload.coverage.throughSequence) !==
        payload.sourceDigest
      )
        throw new Error('Checkpoint source digest no longer matches the captured history.')
      return { checkpointEventId: this.eventLog.recordContextCheckpoint(run, payload) }
    })
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
      const existing = this.eventLog.findRunByRequestId(input.sessionId, input.requestId)
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
        .prepare(`INSERT INTO turns (id, session_id, ordinal, created_at, checkpoint_event_id)
          VALUES (?, ?, ?, ?, (SELECT id FROM runtime_events WHERE session_id = ?
            AND kind = 'context_checkpoint_recorded' ORDER BY session_sequence DESC LIMIT 1))`)
        .run(turnId, input.sessionId, turnOrdinal, now, input.sessionId)
      this.dependencies.database.connection
        .prepare(
          `INSERT INTO runs (id, session_id, turn_id, attempt, status, started_at, finished_at, failure_json)
           VALUES (?, ?, ?, 1, 'running', ?, NULL, NULL)`
        )
        .run(runId, input.sessionId, turnId, now)
      this.eventLog.appendEvent(run, 'run_started', {
        attempt: 1,
        profile: input.profile,
        requestId: input.requestId
      })
      this.eventLog.appendEvent(run, 'user_message_recorded', {
        message: visibleMessage(input.userMessage)
      })
      this.touchSession(input.sessionId)
      // Replay construction belongs to the lifecycle transaction: a corrupt pinned
      // checkpoint must reject the turn instead of committing a stranded running run.
      this.getReplayMessages(runId)
      return this.toStartedRun(run)
    })
  }

  finishRun(runId: string, outcome: RunOutcome): void {
    switch (outcome.status) {
      case 'completed':
        this.completeTerminalRun(runId, 'completed', 'run_completed', (run) =>
          this.eventLog.appendEvent(run, 'assistant_output_finalized', {
            message: visibleMessage(outcome.assistant)
          })
        )
        return
      case 'failed':
        this.completeTerminalRun(
          runId,
          'failed',
          'run_failed',
          (run) => {
            if (outcome.assistant)
              this.eventLog.appendEvent(run, 'assistant_output_snapshot', {
                message: visibleMessage({
                  ...outcome.assistant,
                  metadata: { completionState: 'stopped' }
                })
              })
          },
          outcome.failure
        )
        return
      case 'cancelled':
        this.completeTerminalRun(runId, 'cancelled', 'run_cancelled', (run) =>
          outcome.assistant
            ? this.eventLog.appendEvent(run, 'assistant_output_finalized', {
                message: visibleMessage(outcome.assistant)
              })
            : undefined
        )
    }
  }

  /**
   * Accepts one turn attempt — new, retried, or an idempotent resubmission —
   * marks the model request started, and returns the run scoped to this
   * process. Everything the executor needs from the event log rides on the
   * handle.
   */
  beginTurn(input: {
    sessionId: string
    requestId: string
    userMessage: ChatMessage
    profile: ExecutionProfileSnapshot
    retry: boolean
    retryRunId?: string
  }): TurnRunHandle {
    const started =
      input.retry || input.retryRunId
        ? this.retryTurn({
            sessionId: input.sessionId,
            requestId: input.requestId,
            userMessage: input.userMessage,
            retryRunId: input.retryRunId
          })
        : this.startTurn({
            sessionId: input.sessionId,
            requestId: input.requestId,
            userMessage: input.userMessage,
            profile: input.profile
          })
    this.markRequestStarted(started.runId)
    const { cwd } = this.findSession(input.sessionId)
    const runId = started.runId
    return {
      runId,
      profile: started.profile,
      shouldGenerateTitle: started.shouldGenerateTitle,
      cwd,
      replayMessages: this.getReplayMessages(runId),
      recordModelStep: (step) =>
        this.dependencies.database.transaction(() =>
          this.journal.recordModelStep(this.getRunRow(runId), step)
        ),
      recordToolExecutionStarted: (execution) =>
        this.dependencies.database.transaction(() =>
          this.journal.recordStarted(this.getRunRow(runId), execution)
        ),
      recordToolExecutionSettled: (execution) =>
        this.dependencies.database.transaction(() => {
          this.journal.recordSettled(this.getRunRow(runId), execution)
          this.eventLog.recordToolTrace(this.getRunRow(runId), execution.trace, execution.index)
        }),
      contextMessages: this.eventLog.getTurnContext(started.turnId),
      recordContext: (messages) => this.recordTurnContext(runId, messages),
      recordStep: (step) => this.recordAgentStep(runId, step),
      recordTrace: (trace) => this.recordToolTrace(runId, trace),
      complete: (assistant) => this.finishRun(runId, { status: 'completed', assistant }),
      fail: (failure, assistant) => this.finishRun(runId, { status: 'failed', failure, assistant }),
      cancel: (assistant) =>
        this.finishRun(
          runId,
          assistant ? { status: 'cancelled', assistant } : { status: 'cancelled' }
        )
    }
  }

  getRetryProfile(sessionId: string, retryRunId?: string): ExecutionProfileSnapshot {
    return this.eventLog.getExecutionProfile(this.assertRetrySource(sessionId, retryRunId).id)
  }

  private getRecovery(sessionId: string): SessionRecovery | null {
    // SAFETY: schema-owned event writers and fixed SQL columns establish this stored row shape.
    const row = this.dependencies.database.connection
      .prepare(
        `SELECT runs.* FROM runs JOIN runtime_events e ON e.run_id = runs.id AND e.kind = 'run_started' WHERE runs.session_id = ? ORDER BY e.session_sequence DESC LIMIT 1`
      )
      .get(sessionId) as (RunRow & { failure_json: string | null }) | undefined
    if (!row || (row.status !== 'failed' && row.status !== 'interrupted')) return null
    const unknown = this.journal.hasUnknown(row.turn_id)
    return SessionRecoverySchema.parse({
      runId: row.id,
      turnId: row.turn_id,
      status: row.status,
      failure: row.failure_json
        ? JSON.parse(row.failure_json)
        : { code: 'process_interrupted', message: 'The app closed while this run was active.' },
      canRetry: !unknown,
      blockedReason: unknown ? UNKNOWN_TOOL_OUTCOME_MESSAGE : undefined
    })
  }

  private assertRetrySource(sessionId: string, retryRunId?: string): RunRow {
    const recovery = this.getRecovery(sessionId)
    if (!recovery || (retryRunId && recovery.runId !== retryRunId))
      throw new Error('Retry requires the latest failed or interrupted attempt in this session.')
    if (!recovery.canRetry) throw new Error(recovery.blockedReason)
    const active = this.dependencies.database.connection
      .prepare("SELECT id FROM runs WHERE session_id = ? AND status = 'running'")
      .get(sessionId)
    if (active) throw new Error('Session already has an active run.')
    return this.getRunRow(recovery.runId)
  }

  private retryRun({
    failedRunId,
    requestId
  }: {
    failedRunId: string
    requestId: string
  }): StartedRun {
    const failed = this.getRunRow(failedRunId)
    if (failed.status !== 'failed' && failed.status !== 'interrupted')
      throw new Error('Only failed or interrupted runs can be retried.')
    return this.dependencies.database.transaction(() => {
      this.eventLog.assertRetrySource(failedRunId)
      const runId = this.dependencies.createId()
      const now = this.dependencies.now()
      // SAFETY: this aggregate query always returns one numeric row.
      const attempt =
        (
          this.dependencies.database.connection
            .prepare('SELECT COALESCE(MAX(attempt), 0) AS attempt FROM runs WHERE turn_id = ?')
            // SAFETY: schema-owned event writers and fixed SQL columns establish this stored row shape.
            .get(failed.turn_id) as { attempt: number }
        ).attempt + 1
      const profile = this.eventLog.getExecutionProfile(failed.id)
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
      this.eventLog.appendEvent(run, 'run_started', {
        attempt,
        profile,
        requestId,
        retryRunId: failedRunId
      })
      this.touchSession(failed.session_id)
      // A corrupt pinned checkpoint must reject the retry inside this transaction
      // instead of committing a stranded running run.
      this.getReplayMessages(runId)
      return this.toStartedRun(run)
    })
  }

  retryTurn({
    sessionId,
    requestId,
    userMessage,
    retryRunId
  }: {
    sessionId: string
    requestId: string
    userMessage: ChatMessage
    retryRunId?: string
  }): StartedRun {
    const existing = this.eventLog.findRunByRequestId(sessionId, requestId)
    if (existing) {
      if (existing.attempt === 1)
        throw new Error('Request ID was already used to start a new turn.')
      this.assertRetryReplay(existing, userMessage)
      if (retryRunId) {
        const source = this.dependencies.database.connection
          .prepare('SELECT id FROM runs WHERE turn_id = ? AND attempt = ?')
          .get(existing.turn_id, existing.attempt - 1)
        // SAFETY: the fixed SELECT returns only the source run identity.
        if (!source || (source as { id: string }).id !== retryRunId)
          throw new Error('Request ID was already used with a different retry source.')
      }
      return this.toStartedRun(existing)
    }

    const failed = this.assertRetrySource(sessionId, retryRunId)
    this.assertRetryReplay(failed, userMessage)
    return this.retryRun({ failedRunId: failed.id, requestId })
  }

  recoverInterruptedRuns(): number {
    // SAFETY: runs.* maps to the schema-controlled runs table.
    const runningRuns = this.dependencies.database.connection
      .prepare("SELECT * FROM runs WHERE status = 'running'")
      // SAFETY: schema-owned event writers and fixed SQL columns establish this stored row shape.
      .all() as RunRow[]
    for (const run of runningRuns) {
      this.dependencies.database.transaction(() => {
        this.eventLog.appendEvent(run, 'run_failed', {
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
    failure?: TurnFailure
  ): void {
    this.dependencies.database.transaction(() => {
      const run = this.getRunRow(runId)
      if (run.status === status && this.eventLog.findTerminalEvent(runId)) return
      if (run.status !== 'running')
        throw new Error('Run already has a contradictory terminal state.')
      beforeEvent(run)
      this.eventLog.appendToolTraceSummary(run)
      this.eventLog.appendEvent(run, event, failure ?? {})
      this.dependencies.database.connection
        .prepare('UPDATE runs SET status = ?, finished_at = ?, failure_json = ? WHERE id = ?')
        .run(status, this.dependencies.now(), failure ? canonicalJson(failure) : null, runId)
    })
  }

  private assertStartTurnReplay(run: RunRow, input: StartTurnInput): void {
    const storedMessage = this.eventLog.getTurnUserMessage(run.turn_id)
    const storedProfile = this.eventLog.getExecutionProfile(run.id)
    if (
      canonicalJson(storedMessage) !== canonicalJson(visibleMessage(input.userMessage)) ||
      canonicalJson(storedProfile) !== canonicalJson(input.profile)
    ) {
      throw new Error('Request ID was already used with different turn input.')
    }
  }

  private assertRetryReplay(run: RunRow, userMessage: ChatMessage): void {
    if (
      canonicalJson(this.eventLog.getTurnUserMessage(run.turn_id)) !==
      canonicalJson(visibleMessage(userMessage))
    ) {
      throw new Error('Request ID was already used with a different user message.')
    }
  }

  private toStartedRun(run: RunRow): StartedRun {
    return {
      runId: run.id,
      turnId: run.turn_id,
      shouldGenerateTitle: this.eventLog.shouldGenerateTitle(run),
      profile: this.eventLog.getExecutionProfile(run.id)
    }
  }

  private findSession(id: string): SessionRow {
    // SAFETY: sessions.* maps to the schema-controlled sessions table.
    const row = this.dependencies.database.connection
      .prepare('SELECT * FROM sessions WHERE id = ?')
      // SAFETY: schema-owned event writers and fixed SQL columns establish this stored row shape.
      .get(id) as SessionRow | undefined
    if (!row) throw new Error('Session does not exist.')
    return row
  }
  private getRunRow(id: string): RunRow {
    // SAFETY: runs.* maps to the schema-controlled runs table.
    const row = this.dependencies.database.connection
      .prepare('SELECT * FROM runs WHERE id = ?')
      // SAFETY: schema-owned event writers and fixed SQL columns establish this stored row shape.
      .get(id) as RunRow | undefined
    if (!row) throw new Error('Run does not exist.')
    return row
  }

  private nextTurnOrdinal(sessionId: string): number {
    // SAFETY: the aggregate query always returns one numeric row.
    const row = this.dependencies.database.connection
      .prepare('SELECT COALESCE(MAX(ordinal), 0) AS ordinal FROM turns WHERE session_id = ?')
      // SAFETY: schema-owned event writers and fixed SQL columns establish this stored row shape.
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
function toSessionSummary(row: SessionRow): SessionSummary {
  // SAFETY: default profiles are serialized by canonicalJson from an ExecutionProfileSnapshot.
  return {
    id: row.id,
    title: row.title,
    projectId: row.project_id,
    cwd: row.cwd,
    defaultProfile: row.default_execution_profile_json
      ? // SAFETY: schema-owned event writers and fixed SQL columns establish this stored row shape.
        (JSON.parse(row.default_execution_profile_json) as ExecutionProfileSnapshot)
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at
  }
}

export type {
  ExecutionProfileSnapshot,
  PersistedSession,
  SessionRuntimeServiceDependencies,
  SessionSummary,
  StartedRun,
  TurnRunHandle
}
export { SessionRuntimeService }
