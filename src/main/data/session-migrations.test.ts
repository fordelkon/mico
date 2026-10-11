import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { SessionDatabase } from './session-database'
import { sessionMigrations } from './session-migrations'
import { SqliteDatabase } from './sqlite-database'

const databases: SessionDatabase[] = []
const paths: string[] = []
afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function openAtPreCheckpointSchema(path: string) {
  return SqliteDatabase.open({
    path,
    migrations: sessionMigrations.slice(
      0,
      sessionMigrations.findIndex((migration) => migration.id === '0007_tool_execution_journal') + 1
    ),
    migrationTable: 'session_schema_migrations',
    label: 'Session'
  })
}

describe('Session migrations', () => {
  it('user reopens when the journal schema upgrades, then event bytes and indexes survive', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mico-checkpoint-migration-'))
    paths.push(directory)
    const path = join(directory, 'sessions.db')
    const legacy = await openAtPreCheckpointSchema(path)
    try {
      legacy.connection.exec(`
        INSERT INTO sessions (id, title, default_execution_profile_json, created_at, updated_at, last_activity_at)
        VALUES ('session-1', 'Legacy', NULL, 1, 1, 1);
        INSERT INTO turns (id, session_id, ordinal, created_at) VALUES ('turn-1', 'session-1', 1, 1);
        INSERT INTO runs (id, session_id, turn_id, attempt, status, started_at)
          VALUES ('run-1', 'session-1', 'turn-1', 1, 'completed', 1);
      `)
      const payloadJson =
        '{"attempt":1,"profile":{"configurationDigest":"digest","modelEntryId":"model","modelId":"model","providerId":"provider","thinkingEffort":"default"},"requestId":"request-1"}'
      legacy.connection
        .prepare(
          `INSERT INTO runtime_events (id, session_id, run_id, session_sequence, kind, payload_json, payload_digest, created_at)
           VALUES ('event-1', 'session-1', 'run-1', 1, 'run_started', ?, ?, 1)`
        )
        .run(payloadJson, digest(payloadJson))
    } finally {
      legacy.close()
    }
    const before = new Database(path)
    const storedRows = before
      .prepare('SELECT * FROM runtime_events ORDER BY session_sequence')
      .all()
    before.close()

    const reopened = new SessionDatabase({ getUserDataPath: () => directory })
    databases.push(reopened)
    await reopened.initialize()

    expect(
      reopened.connection.prepare('SELECT * FROM runtime_events ORDER BY session_sequence').all()
    ).toEqual(storedRows)
    expect(
      reopened.connection
        .prepare('SELECT checkpoint_event_id FROM turns WHERE id = ?')
        .get('turn-1')
    ).toEqual({ checkpoint_event_id: null })

    // SAFETY: sqlite_master rows are schema-fixed { name } records.
    const indexes = reopened.connection
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'runtime_events'"
      )
      .all()
      .map((row) => {
        // SAFETY: the fixed sqlite_master query selects only the name column.
        return (row as { name: string }).name
      })
    expect(indexes).toEqual(
      expect.arrayContaining([
        'runtime_events_run_id',
        'runtime_events_session_id',
        'runtime_events_run_request_id',
        'runtime_events_model_step',
        'runtime_events_tool_start',
        'runtime_events_tool_settlement',
        'runtime_events_context_checkpoint'
      ])
    )
  })

  it('user stores checkpoints when coverage differs, then duplicate boundaries are rejected', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mico-checkpoint-unique-'))
    paths.push(directory)
    const path = join(directory, 'sessions.db')
    const legacy = await openAtPreCheckpointSchema(path)
    try {
      legacy.connection.exec(`
        INSERT INTO sessions (id, title, default_execution_profile_json, created_at, updated_at, last_activity_at)
        VALUES ('session-1', 'Legacy', NULL, 1, 1, 1);
        INSERT INTO turns (id, session_id, ordinal, created_at) VALUES ('turn-1', 'session-1', 1, 1);
        INSERT INTO runs (id, session_id, turn_id, attempt, status, started_at)
          VALUES ('run-1', 'session-1', 'turn-1', 1, 'completed', 1);
      `)
    } finally {
      legacy.close()
    }

    const reopened = new SessionDatabase({ getUserDataPath: () => directory })
    databases.push(reopened)
    await reopened.initialize()
    const insertCheckpoint = reopened.connection.prepare(
      `INSERT INTO runtime_events (id, session_id, run_id, session_sequence, kind, payload_json, payload_digest, created_at)
       VALUES (?, 'session-1', 'run-1', ?, 'context_checkpoint_recorded', ?, ?, 2)`
    )
    const first = checkpointPayloadJson(1)
    insertCheckpoint.run('event-2', 2, first, digest(first))
    const second = checkpointPayloadJson(1)
    expect(() => insertCheckpoint.run('event-3', 3, second, digest(second))).toThrow(/UNIQUE/i)
    const differentBoundary = checkpointPayloadJson(2)
    insertCheckpoint.run('event-4', 4, differentBoundary, digest(differentBoundary))
  })
})

function checkpointPayloadJson(throughSequence: number): string {
  const payload = {
    coverage: { throughSequence },
    sourceDigest: 'a'.repeat(64),
    summary: 'Summary.',
    trigger: 'manual'
  }
  return JSON.stringify(
    Object.fromEntries(Object.entries(payload).sort(([left], [right]) => left.localeCompare(right)))
  )
}
