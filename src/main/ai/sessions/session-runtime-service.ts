import { createHash } from 'node:crypto'

import type { ChatMessage, ThinkingSelection } from '@shared/data/schemas/chat'
import { SessionDatabase } from '../../data/session-database'

type ExecutionProfileSnapshot = {
  providerId: string
  modelId: string
  thinkingEffort: ThinkingSelection
  configurationDigest: string
}

type SessionSummary = {
  id: string
  title: string
  defaultProfile: ExecutionProfileSnapshot | null
  createdAt: number
  updatedAt: number
  lastActivityAt: number
}

type PersistedSession = SessionSummary & { messages: ChatMessage[] }

type SourceManifest = { events: Array<{ eventId: string; digest: string }> }
type ContextBuild = { id: string; sourceManifest: SourceManifest }
type AppendedEvent = { id: string; payloadDigest: string }
type VisibleMessage = { role: ChatMessage['role']; parts: Array<{ type: 'text'; text: string }> }
type EventPayload = {
  code?: string
  contextBuildId?: string
  message?: string | VisibleMessage
  requestId?: string
  sourceManifest?: SourceManifest
}
type JsonValue = boolean | JsonObject | JsonValue[] | null | number | string
type JsonObject = { [key: string]: JsonValue }
type StartedRun = { runId: string; turnId: string; contextBuild: ContextBuild }
type StartTurnInput = {
  sessionId: string
  requestId: string
  userMessage: ChatMessage
  profile: ExecutionProfileSnapshot
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

  constructor(dependencies: SessionRuntimeServiceDependencies) {
    this.dependencies = { ...defaultDependencies, ...dependencies }
  }

  createSession({
    title,
    defaultProfile
  }: {
    title: string
    defaultProfile: ExecutionProfileSnapshot | null
  }): SessionSummary {
    const id = this.dependencies.createId()
    const now = this.dependencies.now()
    this.dependencies.database.connection
      .prepare(
        `INSERT INTO sessions (id, title, default_execution_profile_json, created_at, updated_at, last_activity_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, title, defaultProfile ? canonicalJson(defaultProfile) : null, now, now, now)
    return {
      id,
      title,
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
        `SELECT runtime_events.kind, runtime_events.payload_json
         FROM runtime_events
         JOIN runs ON runs.id = runtime_events.run_id
         JOIN turns ON turns.id = runs.turn_id
         WHERE turns.session_id = ? AND runtime_events.kind IN ('user_message_recorded', 'assistant_output_finalized')
         ORDER BY turns.ordinal, runs.attempt, runtime_events.sequence`
      )
      .all(sessionId) as Array<{ kind: string; payload_json: string }>
    return {
      ...toSessionSummary(session),
      messages: rows.map(({ payload_json }) => parseMessagePayload(payload_json).message)
    }
  }

  getContextMessages(runId: string): ChatMessage[] {
    const { contextBuild } = this.toStartedRun(this.getRunRow(runId))
    return contextBuild.sourceManifest.events.map(({ eventId }) => {
      // SAFETY: source manifests only reference runtime events created by this service.
      const event = this.dependencies.database.connection
        .prepare('SELECT payload_json FROM runtime_events WHERE id = ?')
        .get(eventId) as { payload_json: string } | undefined
      if (!event) throw new Error('Context source event does not exist.')
      return parseMessagePayload(event.payload_json).message
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
      if (existing) return this.toStartedRun(existing)
      if (!this.findSession(input.sessionId)) throw new Error('Session does not exist.')
      const active = this.dependencies.database.connection
        .prepare("SELECT id FROM runs WHERE session_id = ? AND status = 'running'")
        .get(input.sessionId)
      if (active) throw new Error('Session already has an active run.')

      const now = this.dependencies.now()
      const turnId = this.dependencies.createId()
      const runId = this.dependencies.createId()
      const turnOrdinal = this.nextOrdinal('turns', 'session_id', input.sessionId)
      this.dependencies.database.connection
        .prepare('INSERT INTO turns (id, session_id, ordinal, created_at) VALUES (?, ?, ?, ?)')
        .run(turnId, input.sessionId, turnOrdinal, now)
      const profileJson = canonicalJson(input.profile)
      this.dependencies.database.connection
        .prepare(
          `INSERT INTO runs (id, session_id, turn_id, attempt, status, execution_profile_snapshot_json, profile_digest, started_at, finished_at, failure_json)
           VALUES (?, ?, ?, 1, 'running', ?, ?, ?, NULL, NULL)`
        )
        .run(runId, input.sessionId, turnId, profileJson, digest(profileJson), now)
      const userEvent = this.appendEvent(runId, 'user_message_recorded', {
        message: visibleMessage(input.userMessage),
        requestId: input.requestId
      })
      const sourceManifest = this.compileSourceManifest(input.sessionId, userEvent)
      const contextBuild = this.createContextBuild(runId, sourceManifest)
      this.appendEvent(runId, 'context_built', { contextBuildId: contextBuild.id, sourceManifest })
      this.touchSession(input.sessionId)
      return { runId, turnId, contextBuild }
    })
  }

  markRequestStarted(runId: string): void {
    this.dependencies.database.transaction(() => {
      if (this.findTerminalEvent(runId)) return
      const started = this.dependencies.database.connection
        .prepare(
          "SELECT id FROM runtime_events WHERE run_id = ? AND kind = 'model_request_started'"
        )
        .get(runId)
      if (started) return
      this.appendEvent(runId, 'model_request_started', {})
    })
  }

  finalizeRun(runId: string, assistant: ChatMessage): void {
    this.completeTerminalRun(runId, 'completed', 'run_completed', () => {
      this.appendEvent(runId, 'assistant_output_finalized', { message: visibleMessage(assistant) })
    })
  }

  failRun(runId: string, failure: { code: string; message: string }): void {
    this.completeTerminalRun(runId, 'failed', 'run_failed', () => undefined, failure)
  }

  cancelRun(runId: string): void {
    this.completeTerminalRun(runId, 'cancelled', 'run_cancelled', () => undefined)
  }

  retryRun({ failedRunId, requestId }: { failedRunId: string; requestId: string }): StartedRun {
    const failed = this.getRunRow(failedRunId)
    if (failed.status !== 'failed') throw new Error('Only failed runs can be retried.')
    return this.dependencies.database.transaction(() => {
      const userEvent = this.dependencies.database.connection
        .prepare(
          "SELECT payload_json FROM runtime_events WHERE run_id = ? AND kind = 'user_message_recorded'"
        )
        .pluck()
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
      this.dependencies.database.connection
        .prepare(`INSERT INTO runs (id, session_id, turn_id, attempt, status, execution_profile_snapshot_json, profile_digest, started_at, finished_at, failure_json)
        VALUES (?, ?, ?, ?, 'running', ?, ?, ?, NULL, NULL)`)
        .run(
          runId,
          failed.session_id,
          failed.turn_id,
          attempt,
          failed.execution_profile_snapshot_json,
          digest(failed.execution_profile_snapshot_json),
          now
        )
      // SAFETY: a failed run was created with exactly one user-message event.
      const originalUserEvent = this.dependencies.database.connection
        .prepare(
          "SELECT id, payload_digest FROM runtime_events WHERE run_id = ? AND kind = 'user_message_recorded'"
        )
        .get(failedRunId) as { id: string; payload_digest: string }
      const sourceManifest = this.compileSourceManifest(failed.session_id, {
        id: originalUserEvent.id,
        payloadDigest: originalUserEvent.payload_digest
      })
      const contextBuild = this.createContextBuild(runId, sourceManifest)
      this.appendEvent(runId, 'context_built', {
        contextBuildId: contextBuild.id,
        requestId,
        sourceManifest
      })
      this.touchSession(failed.session_id)
      return { runId, turnId: failed.turn_id, contextBuild }
    })
  }

  recoverInterruptedRuns(): number {
    // SAFETY: the selected id column is defined by the migration.
    const runningRuns = this.dependencies.database.connection
      .prepare("SELECT id FROM runs WHERE status = 'running'")
      .all() as Array<{ id: string }>
    for (const { id } of runningRuns) {
      this.dependencies.database.transaction(() => {
        this.appendEvent(id, 'run_failed', {
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
            id
          )
      })
    }
    return runningRuns.length
  }

  private completeTerminalRun(
    runId: string,
    status: 'completed' | 'failed' | 'cancelled',
    event: 'run_completed' | 'run_failed' | 'run_cancelled',
    beforeEvent: () => void,
    failure?: { code: string; message: string }
  ): void {
    this.dependencies.database.transaction(() => {
      const run = this.getRunRow(runId)
      if (run.status === status && this.findTerminalEvent(runId)) return
      if (run.status !== 'running')
        throw new Error('Run already has a contradictory terminal state.')
      beforeEvent()
      this.appendEvent(runId, event, failure ?? {})
      this.dependencies.database.connection
        .prepare('UPDATE runs SET status = ?, finished_at = ?, failure_json = ? WHERE id = ?')
        .run(status, this.dependencies.now(), failure ? canonicalJson(failure) : null, runId)
    })
  }

  private appendEvent(runId: string, kind: string, payload: EventPayload): AppendedEvent {
    const payloadJson = canonicalJson(payload)
    const payloadDigest = digest(payloadJson)
    const id = this.dependencies.createId()
    this.dependencies.database.connection
      .prepare(
        'INSERT INTO runtime_events (id, run_id, sequence, kind, payload_json, payload_digest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        id,
        runId,
        this.nextOrdinal('runtime_events', 'run_id', runId),
        kind,
        payloadJson,
        payloadDigest,
        this.dependencies.now()
      )
    return { id, payloadDigest }
  }

  private createContextBuild(runId: string, sourceManifest: SourceManifest): ContextBuild {
    const id = this.dependencies.createId()
    const manifestJson = canonicalJson(sourceManifest)
    this.dependencies.database.connection
      .prepare(
        'INSERT INTO context_builds (id, run_id, ordinal, source_manifest_json, context_digest, token_budget, estimated_tokens, compiler_version, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)'
      )
      .run(
        id,
        runId,
        1,
        manifestJson,
        digest(manifestJson),
        Math.ceil(manifestJson.length / 4),
        'v1-visible-text-char4',
        this.dependencies.now()
      )
    return { id, sourceManifest }
  }

  private compileSourceManifest(sessionId: string, userEvent: AppendedEvent): SourceManifest {
    // SAFETY: the selected columns are fixed by this query and migration.
    const rows = this.dependencies.database.connection
      .prepare(
        `SELECT runtime_events.id, runtime_events.payload_digest FROM runtime_events JOIN runs ON runs.id = runtime_events.run_id JOIN turns ON turns.id = runs.turn_id WHERE turns.session_id = ? AND runs.status = 'completed' AND runtime_events.kind IN ('user_message_recorded', 'assistant_output_finalized') ORDER BY turns.ordinal, runtime_events.sequence`
      )
      .all(sessionId) as Array<{ id: string; payload_digest: string }>
    return {
      events: [
        ...rows.map((row) => ({ eventId: row.id, digest: row.payload_digest })),
        { eventId: userEvent.id, digest: userEvent.payloadDigest }
      ]
    }
  }

  private findRunByRequestId(sessionId: string, requestId: string): RunRow | undefined {
    // SAFETY: runs.* maps to the schema-controlled runs table.
    return this.dependencies.database.connection
      .prepare(
        "SELECT runs.* FROM runs JOIN runtime_events ON runtime_events.run_id = runs.id WHERE runs.session_id = ? AND runtime_events.kind = 'user_message_recorded' AND json_extract(runtime_events.payload_json, '$.requestId') = ?"
      )
      .get(sessionId, requestId) as RunRow | undefined
  }
  private toStartedRun(run: RunRow): StartedRun {
    // SAFETY: context builds are created with a schema-controlled source manifest.
    const context = this.dependencies.database.connection
      .prepare('SELECT * FROM context_builds WHERE run_id = ? ORDER BY ordinal LIMIT 1')
      .get(run.id) as { id: string; source_manifest_json: string }
    // SAFETY: source_manifest_json is serialized by canonicalJson from a SourceManifest.
    const sourceManifest = JSON.parse(context.source_manifest_json) as SourceManifest
    return { runId: run.id, turnId: run.turn_id, contextBuild: { id: context.id, sourceManifest } }
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
  private nextOrdinal(
    table: 'turns' | 'runtime_events',
    column: 'session_id' | 'run_id',
    value: string
  ): number {
    const orderColumn = table === 'turns' ? 'ordinal' : 'sequence' // SAFETY: the aggregate query always returns one numeric row.
    const row = this.dependencies.database.connection
      .prepare(
        `SELECT COALESCE(MAX(${orderColumn}), 0) AS ordinal FROM ${table} WHERE ${column} = ?`
      )
      .get(value) as { ordinal: number }
    return row.ordinal + 1
  }
  private touchSession(id: string): void {
    const now = this.dependencies.now()
    this.dependencies.database.connection
      .prepare('UPDATE sessions SET updated_at = ?, last_activity_at = ? WHERE id = ?')
      .run(now, now, id)
  }
}

type SessionRow = {
  id: string
  title: string
  default_execution_profile_json: string | null
  created_at: number
  updated_at: number
  last_activity_at: number
}
type RunRow = {
  id: string
  session_id: string
  turn_id: string
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  execution_profile_snapshot_json: string
}
function toSessionSummary(row: SessionRow): SessionSummary {
  // SAFETY: default profiles are serialized by canonicalJson from an ExecutionProfileSnapshot.
  return {
    id: row.id,
    title: row.title,
    defaultProfile: row.default_execution_profile_json
      ? (JSON.parse(row.default_execution_profile_json) as ExecutionProfileSnapshot)
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at
  }
}
function visibleMessage(message: ChatMessage): VisibleMessage {
  return { role: message.role, parts: message.parts.filter((part) => part.type === 'text') }
}
function parseMessagePayload(value: string): { message: VisibleMessage } {
  // SAFETY: these payloads are written by appendEvent with a visible message.
  return JSON.parse(value) as { message: VisibleMessage }
}
function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
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

export { SessionRuntimeService }
export type {
  ExecutionProfileSnapshot,
  PersistedSession,
  SessionRuntimeServiceDependencies,
  SessionSummary,
  StartedRun
}
