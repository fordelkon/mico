import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@shared/data/schemas/chat'
import { SessionDatabase } from '../../data/session-database'
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
      { session_sequence: 4, kind: 'run_completed' },
      { session_sequence: 5, kind: 'run_started' },
      { session_sequence: 6, kind: 'user_message_recorded' }
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

    expect(service.getContextMessages(secondRun.runId)).toEqual([
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

  it('loads the provider context with one database query', async () => {
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
    queries.length = 0

    const messages = service.getContextMessages(secondRun.runId)

    expect(messages).toEqual([
      userMessage,
      assistantMessage,
      { role: 'user', parts: [{ type: 'text', text: 'second prompt' }] }
    ])
    expect(queries).toHaveLength(1)
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

    expect(() => service.getContextMessages(run.runId)).toThrow(/digest/i)
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

    expect(service.getContextMessages(first.runId)).toEqual([userMessage])
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

  it('excludes reasoning parts from the persisted visible transcript', async () => {
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

    expect(service.loadSession(session.id).messages).toEqual([userMessage, assistantMessage])
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
    expect(service.getContextMessages(next.runId)).toEqual([userMessage, nextMessage])
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
    expect(service.getContextMessages(retried.runId)).toEqual([userMessage])
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
    expect(service.getContextMessages(fourth.runId)).toEqual([
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
