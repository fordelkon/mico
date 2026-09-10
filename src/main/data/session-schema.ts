import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const sessions = sqliteTable('sessions', {
  id: text().primaryKey(),
  title: text().notNull(),
  defaultExecutionProfileJson: text('default_execution_profile_json'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  lastActivityAt: integer('last_activity_at').notNull(),
  archivedAt: integer('archived_at')
})

const turns = sqliteTable(
  'turns',
  {
    id: text().primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    ordinal: integer().notNull(),
    createdAt: integer('created_at').notNull()
  },
  (table) => [uniqueIndex('turns_session_ordinal').on(table.sessionId, table.ordinal)]
)

const runs = sqliteTable(
  'runs',
  {
    id: text().primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    turnId: text('turn_id')
      .notNull()
      .references(() => turns.id, { onDelete: 'cascade' }),
    attempt: integer().notNull(),
    status: text({
      enum: ['running', 'completed', 'failed', 'cancelled', 'interrupted']
    }).notNull(),
    executionProfileSnapshotJson: text('execution_profile_snapshot_json').notNull(),
    profileDigest: text('profile_digest').notNull(),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    failureJson: text('failure_json')
  },
  (table) => [uniqueIndex('runs_turn_attempt').on(table.turnId, table.attempt)]
)

const runtimeEvents = sqliteTable(
  'runtime_events',
  {
    id: text().primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    sequence: integer().notNull(),
    kind: text({
      enum: [
        'user_message_recorded',
        'context_built',
        'model_request_started',
        'assistant_output_finalized',
        'run_failed',
        'run_cancelled',
        'run_completed'
      ]
    }).notNull(),
    payloadJson: text('payload_json').notNull(),
    payloadDigest: text('payload_digest').notNull(),
    createdAt: integer('created_at').notNull()
  },
  (table) => [uniqueIndex('runtime_events_run_sequence').on(table.runId, table.sequence)]
)

const contextBuilds = sqliteTable(
  'context_builds',
  {
    id: text().primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    ordinal: integer().notNull(),
    sourceManifestJson: text('source_manifest_json').notNull(),
    contextDigest: text('context_digest').notNull(),
    tokenBudget: integer('token_budget'),
    estimatedTokens: integer('estimated_tokens').notNull(),
    compilerVersion: text('compiler_version').notNull(),
    createdAt: integer('created_at').notNull()
  },
  (table) => [uniqueIndex('context_builds_run_ordinal').on(table.runId, table.ordinal)]
)

const sessionSchema = { contextBuilds, runtimeEvents, runs, sessions, turns }

export { contextBuilds, runtimeEvents, runs, sessions, sessionSchema, turns }
