import type { ChatProviderMessage } from '@mico/ai-providers'
import type { TurnFailure } from '@shared/ai/turn-failure'
import type { ChatMessage } from '@shared/data/schemas/chat'
import type {
  ExecutionProfileSnapshot,
  PersistedSession,
  SessionSummary
} from '@shared/data/schemas/session'
import { SessionDatabase } from '../../data/session-database'
import type { ToolExecutionTrace } from '../tools/tool-contract'
import {
  canonicalJson,
  type ProviderUserMessage,
  parseTurnContext,
  type RunRow,
  SessionEventLog
} from './session-event-log'
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
  | { status: 'failed'; failure: TurnFailure }
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
  fail: (failure: TurnFailure) => void
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

class SessionRuntimeService {
  private readonly dependencies: Required<SessionRuntimeServiceDependencies>
  private readonly eventLog: SessionEventLog

  constructor(dependencies: SessionRuntimeServiceDependencies) {
    this.dependencies = { ...defaultDependencies, ...dependencies }
    this.eventLog = new SessionEventLog(this.dependencies)
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
    return { ...toSessionSummary(session), messages: this.eventLog.getTranscript(sessionId) }
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
    return this.eventLog.getReplayMessages(this.getRunRow(runId))
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
        .prepare('INSERT INTO turns (id, session_id, ordinal, created_at) VALUES (?, ?, ?, ?)')
        .run(turnId, input.sessionId, turnOrdinal, now)
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
        this.completeTerminalRun(runId, 'failed', 'run_failed', () => undefined, outcome.failure)
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
  }): TurnRunHandle {
    const started = input.retry
      ? this.retryTurn({
          sessionId: input.sessionId,
          requestId: input.requestId,
          userMessage: input.userMessage
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
      contextMessages: this.eventLog.getTurnContext(started.turnId),
      recordContext: (messages) => this.recordTurnContext(runId, messages),
      recordStep: (step) => this.recordAgentStep(runId, step),
      recordTrace: (trace) => this.recordToolTrace(runId, trace),
      complete: (assistant) => this.finishRun(runId, { status: 'completed', assistant }),
      fail: (failure) => this.finishRun(runId, { status: 'failed', failure }),
      cancel: (assistant) =>
        this.finishRun(
          runId,
          assistant ? { status: 'cancelled', assistant } : { status: 'cancelled' }
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
      this.eventLog.assertRetrySource(failedRunId)
      const runId = this.dependencies.createId()
      const now = this.dependencies.now()
      // SAFETY: this aggregate query always returns one numeric row.
      const attempt =
        (
          this.dependencies.database.connection
            .prepare('SELECT COALESCE(MAX(attempt), 0) AS attempt FROM runs WHERE turn_id = ?')
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
    const existing = this.eventLog.findRunByRequestId(sessionId, requestId)
    if (existing) {
      if (existing.attempt === 1)
        throw new Error('Request ID was already used to start a new turn.')
      this.assertRetryReplay(existing, userMessage)
      return this.toStartedRun(existing)
    }

    const failed = this.eventLog.findFailedTurn(sessionId, userMessage)
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

export type {
  ExecutionProfileSnapshot,
  PersistedSession,
  SessionRuntimeServiceDependencies,
  SessionSummary,
  StartedRun,
  TurnRunHandle
}
export { SessionRuntimeService }
