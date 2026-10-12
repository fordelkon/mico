import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import type { ChatMessage } from '@shared/data/schemas/chat'
import { type ChatProvider, type ChatProviderMessage, providerFinish } from '@mico/ai-providers'
import { SessionDatabase } from '@main/data/session-database'
import { sessionMigrations } from '@main/data/session-migrations'
import { ModelLoop } from './model-loop'
import { SessionRuntimeService, type ExecutionProfileSnapshot } from './runtime'
import type { TurnFailure } from '@shared/ai/turn-failure'

const profile: ExecutionProfileSnapshot = {
  modelEntryId: 'ollama:qwen3',
  providerId: 'ollama',
  modelId: 'qwen3:8b',
  thinkingEffort: 'default',
  configurationDigest: 'configuration-digest'
}

const userMessage: ChatMessage = { role: 'user', parts: [{ type: 'text', text: 'first prompt' }] }
const secondPrompt: ChatMessage = { role: 'user', parts: [{ type: 'text', text: 'second prompt' }] }
const assistantMessage: ChatMessage = {
  role: 'assistant',
  parts: [{ type: 'text', text: 'first answer' }]
}

const databases: SessionDatabase[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

async function createService(): Promise<{
  database: SessionDatabase
  service: SessionRuntimeService
}> {
  const database = new SessionDatabase({ getUserDataPath: () => ':memory:' })
  databases.push(database)
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

async function createSession(
  options: Partial<Parameters<SessionRuntimeService['createSession']>[0]> = {}
): Promise<{
  database: SessionDatabase
  service: SessionRuntimeService
  session: ReturnType<SessionRuntimeService['createSession']>
}> {
  const { database, service } = await createService()
  return {
    database,
    service,
    session: service.createSession({ title: 'Session', defaultProfile: profile, ...options })
  }
}

function startTurn(
  service: SessionRuntimeService,
  session: { id: string },
  requestId = 'request-1',
  message: ChatMessage = userMessage
): ReturnType<SessionRuntimeService['startTurn']> {
  return service.startTurn({ sessionId: session.id, requestId, userMessage: message, profile })
}

function completeRun(service: SessionRuntimeService, run: { runId: string }): void {
  service.finishRun(run.runId, { status: 'completed', assistant: assistantMessage })
}

function failRun(
  service: SessionRuntimeService,
  run: { runId: string },
  failure: TurnFailure = { code: 'provider_error', message: 'Offline' }
): void {
  service.finishRun(run.runId, { status: 'failed', failure })
}

describe('SessionRuntimeService', () => {
  it('user sees reasoning replayed when reopening a session with tool steps, then reasoning and trace remain', async () => {
    const { service, session } = await createSession()
    const run = startTurn(service, session)
    service.recordAgentStep(run.runId, {
      index: 1,
      assistant: {
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'Inspect the requested file first.' },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'Read',
            argumentsJson: '{"file_path":"package.json"}'
          }
        ]
      },
      toolResults: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'Read',
          output: '{"name":"mico"}',
          isError: false
        }
      ]
    })
    service.recordToolTrace(run.runId, {
      toolCallId: 'call-1',
      toolName: 'Read',
      input: { file_path: 'package.json' },
      isError: false,
      output: '{"name":"mico"}',
      startedAt: 1,
      finishedAt: 2
    })
    completeRun(service, run)

    expect(service.loadSession(session.id).messages).toEqual([
      userMessage,
      {
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'Inspect the requested file first.' },
          {
            type: 'tool-trace',
            toolCallId: 'call-1',
            toolName: 'Read',
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

  it('user sees the stream order preserved when the finalized reply embeds tool traces, then events do not duplicate it', async () => {
    const { service, session } = await createSession()
    const run = startTurn(service, session)
    service.recordAgentStep(run.runId, {
      index: 1,
      assistant: {
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'Inspect the requested file first.' },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'Read',
            argumentsJson: '{"file_path":"package.json"}'
          }
        ]
      },
      toolResults: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'Read',
          output: '{"name":"mico"}',
          isError: false
        }
      ]
    })
    service.recordToolTrace(run.runId, {
      toolCallId: 'call-1',
      toolName: 'Read',
      input: { file_path: 'package.json' },
      isError: false,
      output: '{"name":"mico"}',
      startedAt: 1,
      finishedAt: 2
    })
    service.finishRun(run.runId, {
      status: 'completed',
      assistant: {
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'Inspect the requested file first.' },
          {
            type: 'tool-trace',
            toolCallId: 'call-1',
            toolName: 'Read',
            input: { path: 'package.json' },
            state: 'output-available',
            output: 'Read 1 line.'
          },
          { type: 'text', text: 'Found the entry point.' },
          { type: 'text', text: 'first answer' }
        ]
      }
    })

    expect(service.loadSession(session.id).messages).toEqual([
      userMessage,
      {
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'Inspect the requested file first.' },
          {
            type: 'tool-trace',
            toolCallId: 'call-1',
            toolName: 'Read',
            input: { path: 'package.json' },
            state: 'output-available',
            output: 'Read 1 line.'
          },
          { type: 'text', text: 'Found the entry point.' },
          { type: 'text', text: 'first answer' }
        ]
      }
    ])
  })

  it('user sees only the successful attempt when a retry completes, then replays skip failed attempts', async () => {
    const { service, session } = await createSession()
    const first = startTurn(service, session)
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
          toolName: 'Read',
          argumentsJson: '{"file_path":"a.txt"}'
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
          toolName: 'Read',
          output: 'contents',
          isError: false
        }
      ]
    })
    failRun(service, first, { code: 'provider_error', message: 'Offline' })

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
            toolName: 'Read',
            output: 'contents',
            isError: false
          }
        ]
      }
    ])

    completeRun(service, retry)
    const next = startTurn(service, session, 'request-2')
    expect(service.getReplayMessages(next.runId)).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'first prompt' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'first answer' }] },
      { role: 'user', parts: [{ type: 'text', text: 'first prompt' }] }
    ])
  })

  it('user keeps documents and reasoning when reloading and continuing, then the content stays intact', async () => {
    const { database, service, session } = await createSession()
    const attachedMessage: ChatMessage = {
      role: 'user',
      parts: [
        { type: 'text', text: 'Review this file.' },
        { type: 'reasoning', text: 'Private reasoning' },
        { type: 'document', name: 'index.ts', text: '  export {}\n' },
        { type: 'document', name: 'a&"b.ts', text: 'export {}' }
      ]
    }
    const expectedMessage = {
      role: 'user',
      parts: [
        { type: 'text', text: 'Review this file.' },
        { type: 'reasoning', text: 'Private reasoning' },
        { type: 'document', name: 'index.ts', text: '  export {}\n' },
        { type: 'document', name: 'a&"b.ts', text: 'export {}' }
      ]
    }
    const firstRun = startTurn(service, session, 'request-1', attachedMessage)
    failRun(service, firstRun, { code: 'provider_error', message: 'Offline' })

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
    ).toThrow(/different user message/)
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
          { type: 'text', text: '<document name="index.ts">\n  export {}\n\n</document>' },
          { type: 'text', text: '<document name="a&amp;&quot;b.ts">\nexport {}\n</document>' }
        ]
      }
    ])
    reloaded.finishRun(retried.runId, { status: 'completed', assistant: assistantMessage })
    const next = startTurn(reloaded, session, 'request-2')
    expect(reloaded.getReplayMessages(next.runId)).toEqual([
      {
        role: 'user',
        parts: [
          { type: 'text', text: 'Review this file.' },
          { type: 'text', text: '<document name="index.ts">\n  export {}\n\n</document>' },
          { type: 'text', text: '<document name="a&amp;&quot;b.ts">\nexport {}\n</document>' }
        ]
      },
      assistantMessage,
      userMessage
    ])
  })

  it('user sees completed tool traces when reloading a session, then they appear in the transcript', async () => {
    const { database, service, session } = await createSession()
    const run = startTurn(service, session)

    service.recordToolTrace(run.runId, {
      toolCallId: 'call-1',
      toolName: 'Write',
      input: { file_path: 'notes.md', content: 'private draft' },
      isError: false,
      output: 'Successfully wrote notes.md.',
      startedAt: 1_010,
      finishedAt: 1_020
    })
    completeRun(service, run)

    const reloaded = new SessionRuntimeService({ database })
    expect(reloaded.loadSession(session.id).messages).toEqual([
      userMessage,
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-trace',
            toolCallId: 'call-1',
            toolName: 'Write',
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

  it('user sees a truncated write preview when the recorded content exceeds the limit, then only the head is kept', async () => {
    const { service, session } = await createSession()
    const run = startTurn(service, session)

    service.recordToolTrace(run.runId, {
      toolCallId: 'call-1',
      toolName: 'Write',
      input: { file_path: 'notes.md', content: 'a'.repeat(64 * 1024 + 1) },
      isError: false,
      output: 'Successfully wrote notes.md.',
      startedAt: 1_010,
      finishedAt: 1_020
    })
    completeRun(service, run)

    expect(service.loadSession(session.id).messages.at(-1)).toMatchObject({
      role: 'assistant',
      parts: [
        {
          type: 'tool-trace',
          toolCallId: 'call-1',
          presentation: {
            type: 'write',
            content: 'a'.repeat(64 * 1024),
            isTruncated: true
          }
        },
        { type: 'text', text: 'first answer' }
      ]
    })
  })

  it('user keeps v6 events when the schema migrates, then the reopened log accepts journal events', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'mico-session-migration-'))
    let legacy: Database.Database | undefined
    let database: SessionDatabase | undefined
    try {
      legacy = new Database(join(userDataPath, 'sessions.db'))
      legacy.exec(
        'CREATE TABLE session_schema_migrations (id TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)'
      )
      for (const migration of sessionMigrations.slice(0, 6)) {
        legacy.exec(migration.sql)
        legacy
          .prepare('INSERT INTO session_schema_migrations (id, applied_at) VALUES (?, ?)')
          .run(migration.id, 1)
      }
      legacy
        .prepare(
          'INSERT INTO sessions (id, title, created_at, updated_at, last_activity_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run('session-1', 'Session', 1, 1, 1)
      legacy
        .prepare('INSERT INTO turns (id, session_id, ordinal, created_at) VALUES (?, ?, ?, ?)')
        .run('turn-1', 'session-1', 1, 1)
      legacy
        .prepare(
          'INSERT INTO runs (id, session_id, turn_id, attempt, status, started_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run('run-1', 'session-1', 'turn-1', 1, 'completed', 1)
      legacy
        .prepare(
          'INSERT INTO runtime_events (id, session_id, run_id, session_sequence, kind, payload_json, payload_digest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          'legacy-event',
          'session-1',
          'run-1',
          1,
          'user_message_recorded',
          '{"message":"kept"}',
          'legacy-digest',
          1
        )
      const insert = legacy.prepare(
        'INSERT INTO runtime_events (id, session_id, run_id, session_sequence, kind, payload_json, payload_digest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      insert.run(
        'legacy-step',
        'session-1',
        'run-1',
        2,
        'agent_step_recorded',
        '{"step":{"index":1}}',
        'step-digest',
        2
      )
      insert.run(
        'legacy-context',
        'session-1',
        'run-1',
        3,
        'turn_context_recorded',
        '{"messages":[]}',
        'context-digest',
        3
      )
      legacy.close()

      database = new SessionDatabase({ getUserDataPath: () => userDataPath })
      await database.initialize()

      expect(
        database.connection.prepare('SELECT * FROM runtime_events WHERE id = ?').get('legacy-event')
      ).toEqual({
        id: 'legacy-event',
        session_id: 'session-1',
        run_id: 'run-1',
        session_sequence: 1,
        kind: 'user_message_recorded',
        payload_json: '{"message":"kept"}',
        payload_digest: 'legacy-digest',
        created_at: 1
      })
      database.connection
        .prepare(
          'INSERT INTO runtime_events (id, session_id, run_id, session_sequence, kind, payload_json, payload_digest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run('event-1', 'session-1', 'run-1', 4, 'model_step_accepted', '{"index":1}', 'digest', 1)

      expect(
        database.connection
          .prepare('SELECT kind FROM runtime_events WHERE id = ?')
          .pluck()
          .get('event-1')
      ).toBe('model_step_accepted')
      expect(
        database.connection
          .prepare('SELECT id FROM session_schema_migrations WHERE id = ?')
          .pluck()
          .get('0007_tool_execution_journal')
      ).toBe('0007_tool_execution_journal')
      database.close()
      database = new SessionDatabase({ getUserDataPath: () => userDataPath })
      await database.initialize()
      expect(
        database.connection
          .prepare(
            "SELECT id,session_sequence,payload_json,payload_digest FROM runtime_events WHERE id IN ('legacy-step','legacy-context') ORDER BY session_sequence"
          )
          .all()
      ).toEqual([
        {
          id: 'legacy-step',
          session_sequence: 2,
          payload_json: '{"step":{"index":1}}',
          payload_digest: 'step-digest'
        },
        {
          id: 'legacy-context',
          session_sequence: 3,
          payload_json: '{"messages":[]}',
          payload_digest: 'context-digest'
        }
      ])
      expect(() =>
        database?.connection
          .prepare(
            'INSERT INTO runtime_events (id,session_id,run_id,session_sequence,kind,payload_json,payload_digest,created_at) VALUES (?,?,?,?,?,?,?,?)'
          )
          .run(
            'duplicate',
            'session-1',
            'run-1',
            5,
            'model_step_accepted',
            '{"index":1}',
            'digest',
            1
          )
      ).toThrow(/UNIQUE/)
    } finally {
      database?.close()
      if (legacy?.open) legacy.close()
      await rm(userDataPath, { force: true, recursive: true })
    }
  })

  it('user sees the project context preserved when loading a project, then projectId and cwd return', async () => {
    const { service, session } = await createSession({
      title: 'Project chat',
      projectId: 'project-1',
      cwd: '/projects/one'
    })

    expect(service.loadSession(session.id)).toMatchObject({
      projectId: 'project-1',
      cwd: '/projects/one'
    })
  })

  it('user sees no project scope when loading a legacy session, then projectId and cwd are null', async () => {
    const { service, session } = await createSession({ title: 'Legacy chat' })

    expect(service.loadSession(session.id)).toMatchObject({ projectId: null, cwd: null })
  })

  it('user sees the manual title kept when a generated title matches it, then the rename is skipped', async () => {
    const { service, session } = await createSession({ title: 'New chat' })

    service.renameSession(session.id, 'Manual title')

    expect(
      service.renameSessionIfCurrentTitle(session.id, 'New chat', 'Generated title')
    ).toBeNull()
    expect(service.loadSession(session.id).title).toBe('Manual title')
  })

  it('user sees each turn appended in order when runs share a session, then the transcript builds in sequence', async () => {
    const { service, session } = await createSession()
    const firstRun = startTurn(service, session)
    completeRun(service, firstRun)

    startTurn(service, session, 'request-2', secondPrompt)

    expect(service.loadSession(session.id).messages).toEqual([
      userMessage,
      assistantMessage,
      secondPrompt
    ])
  })

  it('user gets the accepted history replayed when a later prompt arrives, then replay has the history plus the prompt', async () => {
    const { service, session } = await createSession()
    const firstRun = startTurn(service, session)
    completeRun(service, firstRun)
    const secondRun = startTurn(service, session, 'request-2', secondPrompt)

    expect(service.getReplayMessages(secondRun.runId)).toEqual([
      userMessage,
      assistantMessage,
      { role: 'user', parts: [{ type: 'text', text: 'second prompt' }] }
    ])
  })

  it('user gets a separate run when the same request ID repeats in another session, then identities stay scoped per session', async () => {
    const { service, session } = await createSession({ title: 'First' })
    const otherSession = service.createSession({ title: 'Second', defaultProfile: profile })
    const first = startTurn(service, session)

    const second = startTurn(service, otherSession)

    expect(second.runId).not.toBe(first.runId)
    expect(service.loadSession(otherSession.id).messages).toEqual([userMessage])
  })

  it('user sees replay rejected when a payload no longer matches its digest, then a digest error is thrown', async () => {
    const { database, service, session } = await createSession()
    const run = startTurn(service, session)
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

  it('user cannot start a second run when one is active, then another session can still start', async () => {
    const { service, session: firstSession } = await createSession({ title: 'First' })
    const secondSession = service.createSession({ title: 'Second', defaultProfile: profile })
    startTurn(service, firstSession)

    expect(() => startTurn(service, firstSession, 'request-2')).toThrow(/active run/i)
    startTurn(service, secondSession, 'request-3')

    expect(service.loadSession(secondSession.id).messages).toEqual([userMessage])
  })

  it('user gets the original run when repeating a request ID, then no extra user message is recorded', async () => {
    const { service, session } = await createSession()
    const first = startTurn(service, session)
    const repeated = startTurn(service, session)

    expect(repeated).toEqual(first)
    expect(service.loadSession(session.id).messages).toEqual([
      { role: 'user', parts: userMessage.parts }
    ])
  })

  it('user gets a rejection when repeating a request ID with changed input, then the changes are refused', async () => {
    const { service, session } = await createSession()
    startTurn(service, session)

    expect(() =>
      startTurn(service, session, 'request-1', {
        role: 'user',
        parts: [{ type: 'text', text: 'different prompt' }]
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

  it('user gets the original context when re-sending a completed request ID, then the same run returns', async () => {
    const { service, session } = await createSession()
    const first = startTurn(service, session)
    completeRun(service, first)
    const second = startTurn(service, session, 'request-2', secondPrompt)
    completeRun(service, second)

    expect(service.getReplayMessages(first.runId)).toEqual([userMessage])
    expect(startTurn(service, session)).toEqual(first)
  })

  it('user gets one model_request_started event when notified twice, then duplicates are ignored', async () => {
    const { database, service, session } = await createSession()
    const run = startTurn(service, session)

    service.markRequestStarted(run.runId)
    service.markRequestStarted(run.runId)

    expect(
      database.connection
        .prepare("SELECT * FROM runtime_events WHERE run_id = ? AND kind = 'model_request_started'")
        .all(run.runId)
    ).toHaveLength(1)
  })

  it('user gets one terminal event per run when finishRun repeats, then messages build without duplicates', async () => {
    const { database, service, session } = await createSession()
    const completed = startTurn(service, session)
    completeRun(service, completed)
    completeRun(service, completed)
    const failed = startTurn(service, session, 'request-2', secondPrompt)
    failRun(service, failed)
    failRun(service, failed)

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

  it('user sees reasoning parts preserved when loading a transcript, then they remain in messages', async () => {
    const { service, session } = await createSession()
    const run = startTurn(service, session)
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

  it('user gets the session removed when deleting a completed session, then its turns and events go too', async () => {
    const { database, service, session } = await createSession()
    const run = startTurn(service, session)
    completeRun(service, run)

    service.deleteSession(session.id)

    expect(service.listSessions()).toEqual([])
    expect(() => service.loadSession(session.id)).toThrow('Session does not exist.')
    expect(database.connection.prepare('SELECT * FROM runs').all()).toEqual([])
    expect(database.connection.prepare('SELECT * FROM runtime_events').all()).toEqual([])
    expect(database.connection.prepare('SELECT * FROM turns').all()).toEqual([])
  })

  it('user cannot delete a session when a run is active, then the deletion is refused', async () => {
    const { service, session } = await createSession()
    startTurn(service, session)

    expect(() => service.deleteSession(session.id)).toThrow('Session has an active run.')
    expect(service.listSessions()).toHaveLength(1)
  })

  it('user streams invalid usage when a step finishes, then the runner rejects without persisting an event', async () => {
    const { database, service, session } = await createSession()
    const run = service.beginTurn({
      sessionId: session.id,
      requestId: 'first',
      userMessage,
      profile,
      retry: false
    })
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      stream: async () =>
        (async function* () {
          yield { type: 'text-delta' as const, id: 'answer', delta: 'done' }
          yield providerFinish({ reason: 'stop', usage: { inputTokens: Number.NaN } })
        })()
    }
    await expect(
      new ModelLoop().run({
        provider,
        messages: run.replayMessages,
        thinkingEffort: 'none',
        signal: new AbortController().signal,
        emit: () => undefined,
        journal: {
          recordModelStep: run.recordModelStep,
          recordToolExecutionStarted: run.recordToolExecutionStarted,
          recordToolExecutionSettled: run.recordToolExecutionSettled
        }
      })
    ).rejects.toThrow(/inputTokens/)
    expect(
      database.connection
        .prepare(
          "SELECT payload_json FROM runtime_events WHERE run_id = ? AND kind = 'model_step_accepted'"
        )
        .all(run.runId)
    ).toEqual([])
  })

  it('user sees surviving runs interrupted when recovery executes, then each run records a failure event', async () => {
    const { database, service, session } = await createSession()
    const run = startTurn(service, session)

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

  it('user keeps the aborted prompt when no assistant text came, then the next turn includes only it', async () => {
    const { service, session } = await createSession()
    const cancelled = startTurn(service, session)
    service.finishRun(cancelled.runId, { status: 'cancelled' })

    const nextMessage: ChatMessage = {
      role: 'user',
      parts: [{ type: 'text', text: 'second prompt' }]
    }
    const next = startTurn(service, session, 'request-2', nextMessage)

    expect(service.loadSession(session.id).messages).toEqual([userMessage, nextMessage])
    expect(service.getReplayMessages(next.runId)).toEqual([userMessage, nextMessage])
  })

  it('user retries a failed run when calling retryTurn, then it reuses the turn without a new event', async () => {
    const { database, service, session } = await createSession()
    const failed = startTurn(service, session)
    failRun(service, failed)

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

  it('user gets the original retry when repeating a retry request ID, then changed input is rejected', async () => {
    const { database, service, session } = await createSession()
    const failed = startTurn(service, session)
    failRun(service, failed)
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

  it('user sees one user message when retrying a failed turn, then the transcript is not duplicated', async () => {
    const { service, session } = await createSession()
    const failed = startTurn(service, session)
    failRun(service, failed)

    const retried = service.retryTurn({
      sessionId: session.id,
      requestId: 'request-2',
      userMessage
    })
    completeRun(service, retried)

    expect(service.loadSession(session.id).messages).toEqual([userMessage, assistantMessage])
  })

  it('user cannot retry an earlier failure when a later turn completed, then stale recovery is rejected', async () => {
    const { service, session } = await createSession()
    const failed = startTurn(service, session)
    failRun(service, failed)
    const later = startTurn(service, session, 'later', secondPrompt)
    completeRun(service, later)
    expect(() =>
      service.retryTurn({
        sessionId: session.id,
        requestId: 'stale',
        userMessage,
        retryRunId: failed.runId
      })
    ).toThrow(/latest/)
    expect(service.loadSession(session.id).recovery).toBeNull()
  })
})
