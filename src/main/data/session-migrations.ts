type SessionMigration = {
  id:
    | '0001_runtime_log'
    | '0002_session_project'
    | '0003_session_cwd'
    | '0004_tool_trace_events'
    | '0005_agent_replay_events'
    | '0006_turn_context_events'
  sql: string
}

const sessionMigrations: readonly SessionMigration[] = [
  {
    id: '0001_runtime_log',
    sql: `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        default_execution_profile_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL
      );

      CREATE INDEX sessions_last_activity_at ON sessions(last_activity_at DESC);

      CREATE TABLE turns (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(session_id, ordinal)
      );

      CREATE TABLE runs (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
        attempt INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'cancelled', 'interrupted')),
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        failure_json TEXT,
        UNIQUE(turn_id, attempt)
      );

      CREATE INDEX runs_session_id ON runs(session_id);
      CREATE UNIQUE INDEX runs_one_running_per_session ON runs(session_id) WHERE status = 'running';

      CREATE TABLE runtime_events (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        session_sequence INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN (
          'run_started',
          'user_message_recorded',
          'model_request_started',
          'assistant_output_finalized',
          'run_failed',
          'run_cancelled',
          'run_completed'
        )),
        payload_json TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(session_id, session_sequence)
      );

      CREATE INDEX runtime_events_run_id ON runtime_events(run_id);
      CREATE INDEX runtime_events_session_id ON runtime_events(session_id, session_sequence);
      CREATE UNIQUE INDEX runtime_events_run_request_id
      ON runtime_events(session_id, json_extract(payload_json, '$.requestId'))
      WHERE kind = 'run_started';
    `
  },
  {
    id: '0002_session_project',
    sql: `
      ALTER TABLE sessions ADD COLUMN project_id TEXT;
      CREATE INDEX sessions_project_id ON sessions(project_id);
    `
  },
  {
    id: '0003_session_cwd',
    sql: `
      ALTER TABLE sessions ADD COLUMN cwd TEXT;
    `
  },
  {
    id: '0004_tool_trace_events',
    // SQLite cannot alter a CHECK constraint. Rebuild only the child event log while preserving
    // every append-only row, digest, sequence, and foreign-key relationship.
    sql: `
      CREATE TABLE runtime_events_next (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        session_sequence INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN (
          'run_started',
          'user_message_recorded',
          'model_request_started',
          'assistant_output_finalized',
          'tool_trace_recorded',
          'tool_trace_summary_recorded',
          'run_failed',
          'run_cancelled',
          'run_completed'
        )),
        payload_json TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(session_id, session_sequence)
      );

      INSERT INTO runtime_events_next (
        id, session_id, run_id, session_sequence, kind, payload_json, payload_digest, created_at
      ) SELECT id, session_id, run_id, session_sequence, kind, payload_json, payload_digest, created_at
        FROM runtime_events;

      DROP TABLE runtime_events;
      ALTER TABLE runtime_events_next RENAME TO runtime_events;

      CREATE INDEX runtime_events_run_id ON runtime_events(run_id);
      CREATE INDEX runtime_events_session_id ON runtime_events(session_id, session_sequence);
      CREATE UNIQUE INDEX runtime_events_run_request_id
      ON runtime_events(session_id, json_extract(payload_json, '$.requestId'))
      WHERE kind = 'run_started';
    `
  },
  {
    id: '0005_agent_replay_events',
    sql: `
      CREATE TABLE runtime_events_next (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        session_sequence INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN (
          'run_started', 'user_message_recorded', 'model_request_started',
          'assistant_output_finalized', 'tool_trace_recorded', 'tool_trace_summary_recorded',
          'agent_step_recorded',
          'run_failed', 'run_cancelled', 'run_completed'
        )),
        payload_json TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(session_id, session_sequence)
      );
      INSERT INTO runtime_events_next (id, session_id, run_id, session_sequence, kind, payload_json, payload_digest, created_at)
        SELECT id, session_id, run_id, session_sequence, kind, payload_json, payload_digest, created_at FROM runtime_events;
      DROP TABLE runtime_events;
      ALTER TABLE runtime_events_next RENAME TO runtime_events;
      CREATE INDEX runtime_events_run_id ON runtime_events(run_id);
      CREATE INDEX runtime_events_session_id ON runtime_events(session_id, session_sequence);
      CREATE UNIQUE INDEX runtime_events_run_request_id ON runtime_events(session_id, json_extract(payload_json, '$.requestId')) WHERE kind = 'run_started';
    `
  },
  {
    id: '0006_turn_context_events',
    sql: `
      CREATE TABLE runtime_events_next (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        session_sequence INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN (
          'run_started', 'user_message_recorded', 'model_request_started',
          'assistant_output_finalized', 'tool_trace_recorded', 'tool_trace_summary_recorded',
          'agent_step_recorded', 'turn_context_recorded',
          'run_failed', 'run_cancelled', 'run_completed'
        )),
        payload_json TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(session_id, session_sequence)
      );
      INSERT INTO runtime_events_next (id, session_id, run_id, session_sequence, kind, payload_json, payload_digest, created_at)
        SELECT id, session_id, run_id, session_sequence, kind, payload_json, payload_digest, created_at FROM runtime_events;
      DROP TABLE runtime_events;
      ALTER TABLE runtime_events_next RENAME TO runtime_events;
      CREATE INDEX runtime_events_run_id ON runtime_events(run_id);
      CREATE INDEX runtime_events_session_id ON runtime_events(session_id, session_sequence);
      CREATE UNIQUE INDEX runtime_events_run_request_id ON runtime_events(session_id, json_extract(payload_json, '$.requestId')) WHERE kind = 'run_started';
    `
  }
]

export type { SessionMigration }
export { sessionMigrations }
