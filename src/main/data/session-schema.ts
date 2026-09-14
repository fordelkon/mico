import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const sessions = sqliteTable('sessions', {
  id: text().primaryKey(),
  title: text().notNull(),
  defaultExecutionProfileJson: text('default_execution_profile_json'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  lastActivityAt: integer('last_activity_at').notNull()
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
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    sessionSequence: integer('session_sequence').notNull(),
    kind: text({
      enum: [
        'run_started',
        'user_message_recorded',
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
  (table) => [
    index('runtime_events_run_id').on(table.runId),
    uniqueIndex('runtime_events_session_sequence').on(table.sessionId, table.sessionSequence)
  ]
)

const sessionSchema = { runtimeEvents, runs, sessions, turns }

export { runtimeEvents, runs, sessions, sessionSchema, turns }
