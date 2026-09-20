import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@shared/data/schemas/chat'
import type { ChatProviderMessage } from '@mico/ai-providers'
import { SessionDatabase } from '../../data/session-database'
import { sessionMigrations } from '../../data/session-migrations'
import { SessionRuntimeService, type ExecutionProfileSnapshot } from './session-runtime-service'

const profile: ExecutionProfileSnapshot = {
  modelEntryId: 'ollama:qwen3',
  providerId: 'ollama',
  modelId: 'qwen3:8b',
  thinkingEffort: 'default',
  configurationDigest: 'configuration-digest'
}

const userMessage: ChatMessage = { role: 'user', parts: [{ type: 'text', text: 'first prompt' }] }
const assistantMessage: ChatMessage = {
  role: 'assistant',
  parts: [{ type: 'text', text: 'first answer' }]
}

async function createService(verbose?: (message: string) => void): Promise<{
  database: SessionDatabase
  service: SessionRuntimeService
}> {
  const database = new SessionDatabase({
    getUserDataPath: () => 'unused-for-memory-database',
    openDatabase: () =>
      new Database(':memory:', {
        // SAFETY: better-sqlite3 documents verbose messages as executed SQL strings.
        verbose: verbose as Database.Options['verbose']
      })
  })
  await database.initialize()
  const service = new SessionRuntimeService({
    createId: (() => {
      let nextId = 0
      return () => `id-${++nextId}`
    })(),
    database,
    now: (() => {
      let timestamp = 1_000
      return () => ++timestamp
    })()
  })
  return { database, service }
}

describe('SessionRuntimeService', () => {
  it('replays reasoning from tool-use steps after reopening a session', async () => {
    const { service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const run = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })
    service.recordAgentStep(run.runId, {
      index: 1,
      assistant: {
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'Inspect the requested file first.' },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'read',
            argumentsJson: '{"path":"package.json"}'
          }
        ]
      },
      toolResults: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'read',
          output: '{"name":"mico"}',
          isError: false
        }
      ]
    })
    service.recordToolTrace(run.runId, {
      toolCallId: 'call-1',
      toolName: 'read',
      input: { path: 'package.json' },
      isError: false,
      output: '{"name":"mico"}',
      startedAt: 1,
      finishedAt: 2
    })
    service.finishRun(run.runId, { status: 'completed', assistant: assistantMessage })

    expect(service.loadSession(session.id).messages).toEqual([
      userMessage,
      {
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'Inspect the requested file first.' },
          {
            type: 'tool-trace',
            toolCallId: 'call-1',
            toolName: 'read',
            input: { path: 'package.json' },
            presentation: {
              type: 'read',
              content: '{"name":"mico"}',
              isTruncated: false
            },
            state: 'output-available',
            output: 'Read 1 line.'
          },
          { type: 'text', text: 'first answer' }
        ]
      }
    ])
  })

  it('does not append failed-attempt replay events after a successful retry', async () => {
    const { service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const first = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })
    const assistant: Extract<ChatProviderMessage, { role: 'assistant' }> = {
      role: 'assistant',
      parts: [
        {
          type: 'reasoning',
          text: 'Inspect first.',
          providerMetadata: { anthropic: { signature: 'signature' } }
        },
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'read',
          argumentsJson: '{"path":"a.txt"}'
        }
      ]
    }
    service.recordAgentStep(first.runId, {
      index: 1,
      assistant,
      toolResults: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'read',
          output: 'contents',
          isError: false
        }
      ]
    })
    service.finishRun(first.runId, {
      status: 'failed',
      failure: { code: 'provider_error', message: 'Offline' }
    })

    const retry = service.retryTurn({ sessionId: session.id, requestId: 'retry-1', userMessage })
    expect(service.getReplayMessages(retry.runId)).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'first prompt' }] },
      assistant,
      {
        role: 'tool',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'read',
            output: 'contents',
            isError: false
          }
        ]
      }
    ])

    service.finishRun(retry.runId, { status: 'completed', assistant: assistantMessage })
    const next = service.startTurn({
      sessionId: session.id,
      requestId: 'request-2',
      userMessage,
      profile
    })
    expect(service.getReplayMessages(next.runId)).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'first prompt' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'first answer' }] },
      { role: 'user', parts: [{ type: 'text', text: 'first prompt' }] }
    ])
  })

  it('preserves documents and reasoning through reload, retry, and later context', async () => {
    const { database, service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const attachedMessage: ChatMessage = {
      role: 'user',
      parts: [
        { type: 'text', text: 'Review this file.' },
        { type: 'reasoning', text: 'Private reasoning' },
        { type: 'document', name: 'index.ts', text: '  export {}\n' }
      ]
    }
    const expectedMessage = {
      role: 'user',
      parts: [
        { type: 'text', text: 'Review this file.' },
        { type: 'reasoning', text: 'Private reasoning' },
        { type: 'document', name: 'index.ts', text: '  export {}\n' }
      ]
    }
    const firstRun = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage: attachedMessage,
      profile
    })
    service.finishRun(firstRun.runId, {
      status: 'failed',
      failure: { code: 'provider_error', message: 'Offline' }
    })

    const reloaded = new SessionRuntimeService({ database })
    expect(reloaded.loadSession(session.id).messages).toEqual([expectedMessage])
    expect(() =>
      reloaded.retryTurn({
        sessionId: session.id,
        requestId: 'wrong-document',
        userMessage: {
          ...attachedMessage,
          parts: [{ type: 'document', name: 'index.ts', text: 'different' }]
        }
      })
    ).toThrow(/Failed turn/)
    const retried = reloaded.retryTurn({
      sessionId: session.id,
      requestId: 'retry-1',
      userMessage: attachedMessage
    })
    expect(reloaded.getReplayMessages(retried.runId)).toEqual([
      {
        role: 'user',
        parts: [
          { type: 'text', text: 'Review this file.' },
          { type: 'text', text: '<document name="index.ts">\n  export {}\n\n</document>' }
        ]
      }
    ])
    reloaded.finishRun(retried.runId, { status: 'completed', assistant: assistantMessage })
    const next = reloaded.startTurn({
      sessionId: session.id,
      requestId: 'request-2',
      userMessage,
      profile
    })
    expect(reloaded.getReplayMessages(next.runId)).toEqual([
      {
        role: 'user',
        parts: [
          { type: 'text', text: 'Review this file.' },
          { type: 'text', text: '<document name="index.ts">\n  export {}\n\n</document>' }
        ]
      },
      assistantMessage,
      userMessage
    ])
  })

  it('projects completed tool traces after reloading a session', async () => {
    const { database, service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const run = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })

    service.recordToolTrace(run.runId, {
      toolCallId: 'call-1',
      toolName: 'write',
      input: { path: 'notes.md', content: 'private draft' },
      isError: false,
      output: 'Successfully wrote notes.md.',
      startedAt: 1_010,
      finishedAt: 1_020
    })
    service.finishRun(run.runId, { status: 'completed', assistant: assistantMessage })

    const reloaded = new SessionRuntimeService({ database })
    expect(reloaded.loadSession(session.id).messages).toEqual([
      userMessage,
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-trace',
            toolCallId: 'call-1',
            toolName: 'write',
            input: { path: 'notes.md' },
            presentation: {
              type: 'write',
              content: 'private draft',
              isTruncated: false,
              operation: 'unknown'
            },
            state: 'output-available',
            output: 'Wrote notes.md.'
          },
          { type: 'text', text: 'first answer' }
        ]
      }
    ])
  })

  it('persists a bounded write preview in tool traces', async () => {
    const { database, service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const run = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })

    service.recordToolTrace(run.runId, {
      toolCallId: 'call-1',
      toolName: 'write',
      input: { path: 'notes.md', content: 'do not persist this text' },
      isError: false,
      output: 'Successfully wrote notes.md.',
      startedAt: 1_010,
      finishedAt: 1_020
    })

    expect(
      database.connection
        .prepare("SELECT payload_json FROM runtime_events WHERE kind = 'tool_trace_recorded'")
        .pluck()
        .get()
    ).toContain('do not persist this text')
  })

  it('migrates an existing event log to accept tool trace event kinds', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'mico-session-migration-'))
    try {
      const legacy = new Database(join(userDataPath, 'sessions.db'))
      legacy.exec(
        'CREATE TABLE session_schema_migrations (id TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)'
      )
      for (const migration of sessionMigrations.slice(0, 3)) {
        legacy.exec(migration.sql)
        legacy
          .prepare('INSERT INTO session_schema_migrations (id, applied_at) VALUES (?, ?)')
          .run(migration.id, 1)
      }
      legacy.close()

      const database = new SessionDatabase({ getUserDataPath: () => userDataPath })
      await database.initialize()

      database.connection
        .prepare(
          'INSERT INTO sessions (id, title, created_at, updated_at, last_activity_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run('session-1', 'Session', 1, 1, 1)
      database.connection
        .prepare('INSERT INTO turns (id, session_id, ordinal, created_at) VALUES (?, ?, ?, ?)')
        .run('turn-1', 'session-1', 1, 1)
      database.connection
        .prepare(
          'INSERT INTO runs (id, session_id, turn_id, attempt, status, started_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run('run-1', 'session-1', 'turn-1', 1, 'completed', 1)
      database.connection
        .prepare(
          'INSERT INTO runtime_events (id, session_id, run_id, session_sequence, kind, payload_json, payload_digest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run('event-1', 'session-1', 'run-1', 1, 'tool_trace_recorded', '{}', 'digest', 1)

      expect(
        database.connection
          .prepare('SELECT kind FROM runtime_events WHERE id = ?')
          .pluck()
          .get('event-1')
      ).toBe('tool_trace_recorded')
      expect(
        database.connection
          .prepare('SELECT id FROM session_schema_migrations WHERE id = ?')
          .pluck()
          .get('0004_tool_trace_events')
      ).toBe('0004_tool_trace_events')
      database.close()
    } finally {
      await rm(userDataPath, { force: true, recursive: true })
    }
  })

  it('preserves the project context captured with a project session', async () => {
    const { service } = await createService()
    const session = service.createSession({
      title: 'Project chat',
      defaultProfile: profile,
      projectId: 'project-1',
      cwd: '/projects/one'
    })

    expect(service.loadSession(session.id)).toMatchObject({
      projectId: 'project-1',
      cwd: '/projects/one'
    })
  })

  it('keeps legacy sessions unscoped', async () => {
    const { service } = await createService()
    const session = service.createSession({ title: 'Legacy chat', defaultProfile: profile })

    expect(service.loadSession(session.id)).toMatchObject({ projectId: null, cwd: null })
  })

  it('keeps a manual title when an automatic title arrives later', async () => {
    const { service } = await createService()
    const session = service.createSession({ title: 'New chat', defaultProfile: profile })

    service.renameSession(session.id, 'Manual title')

    expect(
      service.renameSessionIfCurrentTitle(session.id, 'New chat', 'Generated title')
    ).toBeNull()
    expect(service.loadSession(session.id).title).toBe('Manual title')
  })

  it('appends every durable event in one monotonic session order', async () => {
    const { database, service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const firstRun = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })
    service.finishRun(firstRun.runId, { status: 'completed', assistant: assistantMessage })

    service.startTurn({
      sessionId: session.id,
      requestId: 'request-2',
      userMessage: { role: 'user', parts: [{ type: 'text', text: 'second prompt' }] },
      profile
    })

    expect(
      database.connection
        .prepare('SELECT session_sequence, kind FROM runtime_events ORDER BY session_sequence')
        .all()
    ).toEqual([
      { session_sequence: 1, kind: 'run_started' },
      { session_sequence: 2, kind: 'user_message_recorded' },
      { session_sequence: 3, kind: 'assistant_output_finalized' },
      { session_sequence: 4, kind: 'tool_trace_summary_recorded' },
      { session_sequence: 5, kind: 'run_completed' },
      { session_sequence: 6, kind: 'run_started' },
      { session_sequence: 7, kind: 'user_message_recorded' }
    ])
  })

  it('rebuilds provider context from completed visible history and the current prompt', async () => {
    const { service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const firstRun = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })
    service.finishRun(firstRun.runId, { status: 'completed', assistant: assistantMessage })
    const secondRun = service.startTurn({
      sessionId: session.id,
      requestId: 'request-2',
      userMessage: { role: 'user', parts: [{ type: 'text', text: 'second prompt' }] },
      profile
    })

    expect(service.getReplayMessages(secondRun.runId)).toEqual([
      userMessage,
      assistantMessage,
      { role: 'user', parts: [{ type: 'text', text: 'second prompt' }] }
    ])
  })

  it('records the request identity and execution profile in the run start event', async () => {
    const { database, service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })

    const run = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })

    // SAFETY: this test starts the run immediately before selecting its run_started event.
    const row = database.connection
      .prepare("SELECT payload_json FROM runtime_events WHERE run_id = ? AND kind = 'run_started'")
      .get(run.runId) as { payload_json: string }

    expect(JSON.parse(row.payload_json)).toEqual({ attempt: 1, profile, requestId: 'request-1' })
  })

  it('rebuilds provider history from the accepted run and current prompt', async () => {
    const queries: string[] = []
    const { service } = await createService((query) => queries.push(query))
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const firstRun = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })
    service.finishRun(firstRun.runId, { status: 'completed', assistant: assistantMessage })
    const secondRun = service.startTurn({
      sessionId: session.id,
      requestId: 'request-2',
      userMessage: { role: 'user', parts: [{ type: 'text', text: 'second prompt' }] },
      profile
    })
    const messages = service.getReplayMessages(secondRun.runId)

    expect(messages).toEqual([
      userMessage,
      assistantMessage,
      { role: 'user', parts: [{ type: 'text', text: 'second prompt' }] }
    ])
  })

  it('rejects context payloads whose digest no longer matches the event', async () => {
    const { database, service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const run = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })
    database.connection
      .prepare(
        "UPDATE runtime_events SET payload_json = ? WHERE run_id = ? AND kind = 'user_message_recorded'"
      )
      .run(
        JSON.stringify({
          message: { role: 'user', parts: [{ type: 'text', text: 'changed prompt' }] }
        }),
        run.runId
      )

    expect(() => service.getReplayMessages(run.runId)).toThrow(/digest/i)
  })

  it('rejects a second active run in one session while allowing another session to start', async () => {
    const { service } = await createService()
    const firstSession = service.createSession({ title: 'First', defaultProfile: profile })
    const secondSession = service.createSession({ title: 'Second', defaultProfile: profile })
    service.startTurn({ sessionId: firstSession.id, requestId: 'request-1', userMessage, profile })

    expect(() =>
      service.startTurn({
        sessionId: firstSession.id,
        requestId: 'request-2',
        userMessage,
        profile
      })
    ).toThrow(/active run/i)
    service.startTurn({
      sessionId: secondSession.id,
      requestId: 'request-3',
      userMessage,
      profile
    })

    expect(service.loadSession(secondSession.id).messages).toEqual([userMessage])
  })

  it('returns the original run for a repeated request ID without another user event', async () => {
    const { service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const first = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })
    const repeated = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })

    expect(repeated).toEqual(first)
    expect(service.loadSession(session.id).messages).toEqual([
      { role: 'user', parts: userMessage.parts }
    ])
  })

  it('rejects a repeated request ID when the turn input changed', async () => {
    const { service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })

    expect(() =>
      service.startTurn({
        sessionId: session.id,
        requestId: 'request-1',
        userMessage: { role: 'user', parts: [{ type: 'text', text: 'different prompt' }] },
        profile
      })
    ).toThrow(/different turn input/i)
    expect(() =>
      service.startTurn({
        sessionId: session.id,
        requestId: 'request-1',
        userMessage,
        profile: { ...profile, modelId: 'different-model' }
      })
    ).toThrow(/different turn input/i)
  })

  it('replays a request with the context boundary captured when its run started', async () => {
    const { service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const first = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })
    service.finishRun(first.runId, { status: 'completed', assistant: assistantMessage })
    const second = service.startTurn({
      sessionId: session.id,
      requestId: 'request-2',
      userMessage: { role: 'user', parts: [{ type: 'text', text: 'second prompt' }] },
      profile
    })
    service.finishRun(second.runId, { status: 'completed', assistant: assistantMessage })

    expect(service.getReplayMessages(first.runId)).toEqual([userMessage])
    expect(
      service.startTurn({
        sessionId: session.id,
        requestId: 'request-1',
        userMessage,
        profile
      })
    ).toEqual(first)
  })

  it('uses the request ID index for idempotent run lookup', async () => {
    const { database, service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })

    // SAFETY: EXPLAIN QUERY PLAN always returns rows with a textual detail column.
    const plan = database.connection
      .prepare(
        "EXPLAIN QUERY PLAN SELECT runs.* FROM runtime_events JOIN runs ON runs.id = runtime_events.run_id WHERE runtime_events.session_id = ? AND runtime_events.kind = 'run_started' AND json_extract(runtime_events.payload_json, '$.requestId') = ?"
      )
      .all(session.id, 'request-1') as Array<{ detail: string }>

    expect(plan.map(({ detail }) => detail).join('\n')).toContain('runtime_events_run_request_id')
  })

  it('records the model request start once when the caller retries notification', async () => {
    const { database, service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const run = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })

    service.markRequestStarted(run.runId)
    service.markRequestStarted(run.runId)

    expect(
      database.connection
        .prepare("SELECT * FROM runtime_events WHERE run_id = ? AND kind = 'model_request_started'")
        .all(run.runId)
    ).toHaveLength(1)
  })

  it('writes each terminal event once and rebuilds visible messages from events', async () => {
    const { database, service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const completed = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })
    service.finishRun(completed.runId, { status: 'completed', assistant: assistantMessage })
    service.finishRun(completed.runId, { status: 'completed', assistant: assistantMessage })
    const failed = service.startTurn({
      sessionId: session.id,
      requestId: 'request-2',
      userMessage: { role: 'user', parts: [{ type: 'text', text: 'second prompt' }] },
      profile
    })
    service.finishRun(failed.runId, {
      status: 'failed',
      failure: { code: 'offline', message: 'Offline' }
    })
    service.finishRun(failed.runId, {
      status: 'failed',
      failure: { code: 'offline', message: 'Offline' }
    })

    expect(service.loadSession(session.id).messages).toEqual([
      userMessage,
      assistantMessage,
      {
        role: 'user',
        parts: [{ type: 'text', text: 'second prompt' }]
      }
    ])
    expect(
      database.connection
        .prepare("SELECT * FROM runtime_events WHERE run_id = ? AND kind = 'run_completed'")
        .all(completed.runId)
    ).toHaveLength(1)
    expect(
      database.connection
        .prepare("SELECT * FROM runtime_events WHERE run_id = ? AND kind = 'run_failed'")
        .all(failed.runId)
    ).toHaveLength(1)
  })

  it('preserves reasoning parts in the persisted visible transcript', async () => {
    const { service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const run = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })
    service.finishRun(run.runId, {
      status: 'completed',
      assistant: {
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'private chain of thought' },
          { type: 'text', text: 'first answer' }
        ]
      }
    })

    expect(service.loadSession(session.id).messages).toEqual([
      userMessage,
      {
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'private chain of thought' },
          { type: 'text', text: 'first answer' }
        ]
      }
    ])
  })

  it('permanently deletes a completed session and its runtime records', async () => {
    const { database, service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const run = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })
    service.finishRun(run.runId, { status: 'completed', assistant: assistantMessage })

    service.deleteSession(session.id)

    expect(service.listSessions()).toEqual([])
    expect(() => service.loadSession(session.id)).toThrow('Session does not exist.')
    expect(database.connection.prepare('SELECT * FROM runs').all()).toEqual([])
    expect(database.connection.prepare('SELECT * FROM runtime_events').all()).toEqual([])
    expect(database.connection.prepare('SELECT * FROM turns').all()).toEqual([])
  })

  it('refuses to delete a session with an active run', async () => {
    const { service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    service.startTurn({ sessionId: session.id, requestId: 'request-1', userMessage, profile })

    expect(() => service.deleteSession(session.id)).toThrow('Session has an active run.')
    expect(service.listSessions()).toHaveLength(1)
  })

  it('marks surviving running runs as interrupted during recovery', async () => {
    const { database, service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const run = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })

    expect(service.recoverInterruptedRuns()).toBe(1)
    expect(
      database.connection.prepare('SELECT status FROM runs WHERE id = ?').get(run.runId)
    ).toEqual({
      status: 'interrupted'
    })
    expect(
      database.connection
        .prepare("SELECT * FROM runtime_events WHERE run_id = ? AND kind = 'run_failed'")
        .all(run.runId)
    ).toHaveLength(1)
  })

  it('keeps an aborted prompt in the next context when no assistant text was produced', async () => {
    const { service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const cancelled = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })
    service.finishRun(cancelled.runId, { status: 'cancelled' })

    const nextMessage: ChatMessage = {
      role: 'user',
      parts: [{ type: 'text', text: 'second prompt' }]
    }
    const next = service.startTurn({
      sessionId: session.id,
      requestId: 'request-2',
      userMessage: nextMessage,
      profile
    })

    expect(service.loadSession(session.id).messages).toEqual([userMessage, nextMessage])
    expect(service.getReplayMessages(next.runId)).toEqual([userMessage, nextMessage])
  })

  it('retries a failed run as the next attempt of its original turn without another user event', async () => {
    const { database, service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const failed = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })
    service.finishRun(failed.runId, {
      status: 'failed',
      failure: { code: 'offline', message: 'Offline' }
    })

    const retried = service.retryTurn({
      sessionId: session.id,
      requestId: 'request-2',
      userMessage
    })

    expect(
      database.connection.prepare('SELECT attempt, turn_id FROM runs ORDER BY attempt').all()
    ).toEqual([
      { attempt: 1, turn_id: failed.turnId },
      { attempt: 2, turn_id: failed.turnId }
    ])
    expect(
      database.connection
        .prepare("SELECT * FROM runtime_events WHERE kind = 'user_message_recorded'")
        .all()
    ).toHaveLength(1)
    expect(retried.turnId).toBe(failed.turnId)
    expect(service.getReplayMessages(retried.runId)).toEqual([userMessage])
  })

  it('makes retry request IDs idempotent and rejects changed retry input', async () => {
    const { database, service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const failed = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })
    service.finishRun(failed.runId, {
      status: 'failed',
      failure: { code: 'offline', message: 'Offline' }
    })
    const retried = service.retryTurn({
      sessionId: session.id,
      requestId: 'request-2',
      userMessage
    })

    expect(
      service.retryTurn({
        sessionId: session.id,
        requestId: 'request-2',
        userMessage
      })
    ).toEqual(retried)
    expect(() =>
      service.retryTurn({
        sessionId: session.id,
        requestId: 'request-2',
        userMessage: { role: 'user', parts: [{ type: 'text', text: 'different prompt' }] }
      })
    ).toThrow(/different user message/i)
    expect(database.connection.prepare('SELECT id FROM runs').all()).toHaveLength(2)
  })

  it('retries a failed user turn without duplicating its persisted message', async () => {
    const { service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const failed = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })
    service.finishRun(failed.runId, {
      status: 'failed',
      failure: { code: 'offline', message: 'Offline' }
    })

    const retried = service.retryTurn({
      sessionId: session.id,
      requestId: 'request-2',
      userMessage
    })
    service.finishRun(retried.runId, { status: 'completed', assistant: assistantMessage })

    expect(service.loadSession(session.id).messages).toEqual([userMessage, assistantMessage])
  })

  it('keeps later completed turns in context when an earlier failed turn is retried', async () => {
    const { service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const secondUserMessage: ChatMessage = {
      role: 'user',
      parts: [{ type: 'text', text: 'second prompt' }]
    }
    const thirdUserMessage: ChatMessage = {
      role: 'user',
      parts: [{ type: 'text', text: 'third prompt' }]
    }
    const thirdAssistantMessage: ChatMessage = {
      role: 'assistant',
      parts: [{ type: 'text', text: 'third answer' }]
    }
    const retriedAssistantMessage: ChatMessage = {
      role: 'assistant',
      parts: [{ type: 'text', text: 'retried second answer' }]
    }

    const first = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })
    service.finishRun(first.runId, { status: 'completed', assistant: assistantMessage })
    const failed = service.startTurn({
      sessionId: session.id,
      requestId: 'request-2',
      userMessage: secondUserMessage,
      profile
    })
    service.finishRun(failed.runId, {
      status: 'failed',
      failure: { code: 'offline', message: 'Offline' }
    })
    const third = service.startTurn({
      sessionId: session.id,
      requestId: 'request-3',
      userMessage: thirdUserMessage,
      profile
    })
    service.finishRun(third.runId, { status: 'completed', assistant: thirdAssistantMessage })

    const retried = service.retryTurn({
      sessionId: session.id,
      requestId: 'request-4',
      userMessage: secondUserMessage
    })
    service.finishRun(retried.runId, {
      status: 'completed',
      assistant: retriedAssistantMessage
    })
    const fourth = service.startTurn({
      sessionId: session.id,
      requestId: 'request-5',
      userMessage: { role: 'user', parts: [{ type: 'text', text: 'fourth prompt' }] },
      profile
    })
    expect(service.getReplayMessages(fourth.runId)).toEqual([
      userMessage,
      assistantMessage,
      thirdUserMessage,
      thirdAssistantMessage,
      secondUserMessage,
      retriedAssistantMessage,
      { role: 'user', parts: [{ type: 'text', text: 'fourth prompt' }] }
    ])
  })
})
