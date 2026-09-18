import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/** Durable conversation aggregate. Deleting a session cascades to every turn, run, and event it owns. */
const sessions = sqliteTable('sessions', {
  /** Stable session identity used across the IPC and runtime boundaries. */
  id: text().primaryKey(),
  title: text().notNull(),
  /** Stable workspace-catalog identity; pairs with cwd for project-scoped sessions. */
  projectId: text('project_id'),
  /** Current working directory captured when the session is created. */
  cwd: text(),
  defaultExecutionProfileJson: text('default_execution_profile_json'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  lastActivityAt: integer('last_activity_at').notNull()
})

/** Ordered user requests within one session. */
const turns = sqliteTable(
  'turns',
  {
    /** Stable turn identity, referenced by each execution attempt. */
    id: text().primaryKey(),
    /** Owning session; deletion removes its complete turn history. */
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    /** One-based order that is unique within the owning session. */
    ordinal: integer().notNull(),
    createdAt: integer('created_at').notNull()
  },
  (table) => [uniqueIndex('turns_session_ordinal').on(table.sessionId, table.ordinal)]
)

/** Execution attempts for a turn, including retries. */
const runs = sqliteTable(
  'runs',
  {
    /** Stable execution-attempt identity, referenced by runtime events. */
    id: text().primaryKey(),
    /** Session ownership is retained to query a session's run history directly. */
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    /** The turn this run attempts; attempt is unique within this turn. */
    turnId: text('turn_id')
      .notNull()
      .references(() => turns.id, { onDelete: 'cascade' }),
    /** Retry number, unique with turnId. */
    attempt: integer().notNull(),
    status: text({
      enum: ['running', 'completed', 'failed', 'cancelled', 'interrupted']
    }).notNull(),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    failureJson: text('failure_json')
  },
  (table) => [uniqueIndex('runs_turn_attempt').on(table.turnId, table.attempt)]
)

/** Append-only event log from which messages and run state are projected. */
const runtimeEvents = sqliteTable(
  'runtime_events',
  {
    /** Stable event identity. */
    id: text().primaryKey(),
    /** Session ownership establishes the single ordered event stream. */
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    /** Run that emitted this event. */
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    /** Monotonic sequence, unique within sessionId, for deterministic replay. */
    sessionSequence: integer('session_sequence').notNull(),
    kind: text({
      enum: [
        'run_started',
        'user_message_recorded',
        'model_request_started',
        'assistant_output_finalized',
        'tool_trace_recorded',
        'tool_trace_summary_recorded',
        'run_failed',
        'run_cancelled',
        'run_completed'
      ]
    }).notNull(),
    payloadJson: text('payload_json').notNull(),
    /** Digest verifies the persisted event payload before it is projected. */
    payloadDigest: text('payload_digest').notNull(),
    createdAt: integer('created_at').notNull()
  },
  (table) => [
    index('runtime_events_run_id').on(table.runId),
    uniqueIndex('runtime_events_session_sequence').on(table.sessionId, table.sessionSequence)
  ]
)

const sessionSchema = { runtimeEvents, runs, sessions, turns }

export { runtimeEvents, runs, sessions, sessionSchema, turns }
