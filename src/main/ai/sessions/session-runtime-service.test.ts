import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@shared/data/schemas/chat'
import { SessionDatabase } from '../../data/session-database'
import { SessionRuntimeService, type ExecutionProfileSnapshot } from './session-runtime-service'

const profile: ExecutionProfileSnapshot = {
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

type EventDigestRow = { id: string; payload_digest: string }

function getEventDigest(
  database: SessionDatabase,
  runId: string,
  kind: 'assistant_output_finalized' | 'user_message_recorded'
): EventDigestRow {
  // SAFETY: each caller creates the named event for its run before reading it.
  const event = database.connection
    .prepare('SELECT id, payload_digest FROM runtime_events WHERE run_id = ? AND kind = ?')
    .get(runId, kind) as EventDigestRow | undefined
  if (!event) throw new Error(`Expected ${kind} event for ${runId}.`)
  return event
}

async function createService(): Promise<{
  database: SessionDatabase
  service: SessionRuntimeService
}> {
  const database = new SessionDatabase({
    getUserDataPath: () => 'unused-for-memory-database',
    openDatabase: () => new Database(':memory:')
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
  it('records completed visible history and the new message in the next context manifest', async () => {
    const { database, service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const firstRun = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })
    service.finalizeRun(firstRun.runId, assistantMessage)

    const secondRun = service.startTurn({
      sessionId: session.id,
      requestId: 'request-2',
      userMessage: { role: 'user', parts: [{ type: 'text', text: 'second prompt' }] },
      profile
    })

    const sourceEvents = [
      getEventDigest(database, firstRun.runId, 'user_message_recorded'),
      getEventDigest(database, firstRun.runId, 'assistant_output_finalized'),
      getEventDigest(database, secondRun.runId, 'user_message_recorded')
    ]

    expect(secondRun.contextBuild.sourceManifest.events).toEqual(
      sourceEvents.map(({ id, payload_digest }) => ({ eventId: id, digest: payload_digest }))
    )
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
    service.finalizeRun(firstRun.runId, assistantMessage)
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
    const secondRun = service.startTurn({
      sessionId: secondSession.id,
      requestId: 'request-3',
      userMessage,
      profile
    })

    expect(secondRun.contextBuild.sourceManifest.events).toHaveLength(1)
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
    service.finalizeRun(completed.runId, assistantMessage)
    service.finalizeRun(completed.runId, assistantMessage)
    const failed = service.startTurn({
      sessionId: session.id,
      requestId: 'request-2',
      userMessage: { role: 'user', parts: [{ type: 'text', text: 'second prompt' }] },
      profile
    })
    service.failRun(failed.runId, { code: 'offline', message: 'Offline' })
    service.failRun(failed.runId, { code: 'offline', message: 'Offline' })

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
    service.finalizeRun(run.runId, {
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'private chain of thought' },
        { type: 'text', text: 'first answer' }
      ]
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
    service.finalizeRun(run.runId, assistantMessage)

    service.deleteSession(session.id)

    expect(service.listSessions()).toEqual([])
    expect(() => service.loadSession(session.id)).toThrow('Session does not exist.')
    expect(database.connection.prepare('SELECT * FROM runs').all()).toEqual([])
    expect(database.connection.prepare('SELECT * FROM runtime_events').all()).toEqual([])
    expect(database.connection.prepare('SELECT * FROM context_builds').all()).toEqual([])
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

  it('retries a failed run as the next attempt of its original turn without another user event', async () => {
    const { database, service } = await createService()
    const session = service.createSession({ title: 'Session', defaultProfile: profile })
    const failed = service.startTurn({
      sessionId: session.id,
      requestId: 'request-1',
      userMessage,
      profile
    })
    service.failRun(failed.runId, { code: 'offline', message: 'Offline' })

    const retried = service.retryRun({ failedRunId: failed.runId, requestId: 'request-2' })

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
  })
})
