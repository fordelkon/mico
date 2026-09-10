type SessionMigration = {
  id: '0001_initial_runtime'
  sql: string
}

const sessionMigrations: readonly SessionMigration[] = [
  {
    id: '0001_initial_runtime',
    sql: `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        default_execution_profile_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        archived_at INTEGER
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
        execution_profile_snapshot_json TEXT NOT NULL,
        profile_digest TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        failure_json TEXT,
        UNIQUE(turn_id, attempt)
      );

      CREATE INDEX runs_session_id ON runs(session_id);
      CREATE UNIQUE INDEX runs_one_running_per_session ON runs(session_id) WHERE status = 'running';

      CREATE TABLE runtime_events (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN (
          'user_message_recorded',
          'context_built',
          'model_request_started',
          'assistant_output_finalized',
          'run_failed',
          'run_cancelled',
          'run_completed'
        )),
        payload_json TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(run_id, sequence)
      );

      CREATE INDEX runtime_events_run_id ON runtime_events(run_id, sequence);

      CREATE TABLE context_builds (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        source_manifest_json TEXT NOT NULL,
        context_digest TEXT NOT NULL,
        token_budget INTEGER,
        estimated_tokens INTEGER NOT NULL,
        compiler_version TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(run_id, ordinal)
      );

      CREATE INDEX context_builds_run_id ON context_builds(run_id, ordinal);
    `
  }
]

export { sessionMigrations }
export type { SessionMigration }
