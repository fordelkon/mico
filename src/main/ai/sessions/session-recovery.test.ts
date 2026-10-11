import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatProviderMessage } from '@mico/ai-providers'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionDatabase } from '../../data/session-database'
import { SessionRuntimeService } from './session-runtime-service'

const databases: SessionDatabase[] = []
const paths: string[] = []
afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
const profile = {
  modelEntryId: 'model',
  providerId: 'provider',
  modelId: 'model',
  thinkingEffort: 'default' as const,
  configurationDigest: 'digest'
}
const userMessage = { role: 'user' as const, parts: [{ type: 'text' as const, text: 'Read' }] }
async function setup(directory = ':memory:') {
  const database = new SessionDatabase({ getUserDataPath: () => directory })
  databases.push(database)
  await database.initialize()
  const service = new SessionRuntimeService({ database })
  const session = service.createSession({ title: 'Recovery', defaultProfile: profile })
  const run = service.beginTurn({
    sessionId: session.id,
    requestId: 'first',
    userMessage,
    profile,
    retry: false
  })
  return { database, service, session, run }
}
const assistant = {
  role: 'assistant' as const,
  parts: [
    {
      type: 'tool-call' as const,
      toolCallId: 'read',
      toolName: 'Read',
      argumentsJson: '{"file_path":"a"}'
    }
  ]
}
describe('Session recovery', () => {
  it('user repeats a retry request when its source changes, then the reused request is rejected', async () => {
    const { service, session, run } = await setup()
    run.fail({ code: 'provider_error', message: 'Offline' })
    const retry = service.retryTurn({
      sessionId: session.id,
      requestId: 'retry',
      userMessage,
      retryRunId: run.runId
    })
    expect(() =>
      service.retryTurn({
        sessionId: session.id,
        requestId: 'retry',
        userMessage,
        retryRunId: 'different'
      })
    ).toThrow(/retry source/i)
    expect(
      service.retryTurn({
        sessionId: session.id,
        requestId: 'retry',
        userMessage,
        retryRunId: run.runId
      }).runId
    ).toBe(retry.runId)
  })
  it('user continues after legacy history when restarting, then later steps replay once', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mico-journal-reopen-'))
    paths.push(directory)
    const { database, service, session, run } = await setup(directory)
    run.complete({ role: 'assistant', parts: [{ type: 'text', text: 'Legacy answer' }] })
    const current = service.beginTurn({
      sessionId: session.id,
      requestId: 'second',
      userMessage,
      profile,
      retry: false
    })
    expect(current.replayMessages).toEqual([
      userMessage,
      { role: 'assistant', parts: [{ type: 'text', text: 'Legacy answer' }] },
      userMessage
    ])
    current.recordModelStep({ index: 1, assistant })
    current.recordToolExecutionStarted({ index: 1, toolCallId: 'read', startedAt: 1 })
    current.recordToolExecutionSettled({
      index: 1,
      result: {
        type: 'tool-result',
        toolCallId: 'read',
        toolName: 'Read',
        output: 'contents',
        isError: false
      },
      trace: {
        toolCallId: 'read',
        toolName: 'Read',
        input: { file_path: 'a' },
        output: 'contents',
        isError: false,
        startedAt: 1,
        finishedAt: 2
      }
    })
    current.fail(
      { code: 'provider_error', message: 'Offline' },
      { role: 'assistant', parts: [{ type: 'text', text: 'Partial' }] }
    )
    databases.splice(databases.indexOf(database), 1)
    database.close()
    const reopened = new SessionDatabase({ getUserDataPath: () => directory })
    databases.push(reopened)
    await reopened.initialize()
    const restored = new SessionRuntimeService({ database: reopened })
    expect(restored.loadSession(session.id).messages.at(-1)).toMatchObject({
      metadata: { completionState: 'stopped' },
      parts: [
        expect.objectContaining({ type: 'tool-trace', toolCallId: 'read' }),
        { type: 'text', text: 'Partial' }
      ]
    })
    const retry = restored.beginTurn({
      sessionId: session.id,
      requestId: 'retry',
      userMessage,
      profile,
      retry: true,
      retryRunId: current.runId
    })
    expect(retry.replayMessages).toEqual([
      userMessage,
      { role: 'assistant', parts: [{ type: 'text', text: 'Legacy answer' }] },
      userMessage,
      assistant,
      {
        role: 'tool',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'read',
            toolName: 'Read',
            output: 'contents',
            isError: false
          }
        ]
      }
    ])
    retry.complete({ role: 'assistant', parts: [{ type: 'text', text: 'Final' }] })
    const next = restored.beginTurn({
      sessionId: session.id,
      requestId: 'next',
      userMessage,
      profile,
      retry: false
    })
    expect(next.replayMessages).toEqual([
      userMessage,
      { role: 'assistant', parts: [{ type: 'text', text: 'Legacy answer' }] },
      userMessage,
      assistant,
      {
        role: 'tool',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'read',
            toolName: 'Read',
            output: 'contents',
            isError: false
          }
        ]
      },
      { role: 'assistant', parts: [{ type: 'text', text: 'Final' }] },
      userMessage
    ])
  })
  it('user retries when execution never started, then an error observation replaces dispatch', async () => {
    const { service, session, run } = await setup()
    run.recordModelStep({ index: 1, assistant })
    run.fail(
      { code: 'provider_error', message: 'Offline' },
      { role: 'assistant', parts: [{ type: 'text', text: 'Partial' }] }
    )
    expect(service.loadSession(session.id)).toMatchObject({
      recovery: { runId: run.runId, canRetry: true },
      messages: [userMessage, { role: 'assistant', metadata: { completionState: 'stopped' } }]
    })
    const retry = service.beginTurn({
      sessionId: session.id,
      requestId: 'retry',
      userMessage,
      profile,
      retry: true,
      retryRunId: run.runId
    })
    expect(retry.replayMessages).toEqual([
      userMessage,
      assistant,
      { role: 'tool', parts: [expect.objectContaining({ toolCallId: 'read', isError: true })] }
    ])
  })
  it('user restores an interrupted execution when its outcome is unknown, then retry is blocked', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mico-unknown-reopen-'))
    paths.push(directory)
    const { database, session, run } = await setup(directory)
    run.recordModelStep({ index: 1, assistant })
    run.recordToolExecutionStarted({ index: 1, toolCallId: 'read', startedAt: 1 })
    run.recordToolExecutionSettled({
      index: 1,
      result: {
        type: 'tool-result',
        toolCallId: 'read',
        toolName: 'Read',
        output: 'contents',
        isError: false
      },
      trace: {
        toolCallId: 'read',
        toolName: 'Read',
        input: { file_path: 'a' },
        output: 'contents',
        isError: false,
        startedAt: 1,
        finishedAt: 2
      }
    })
    run.recordModelStep({ index: 2, assistant })
    run.recordToolExecutionStarted({ index: 2, toolCallId: 'read', startedAt: 3 })
    databases.splice(databases.indexOf(database), 1)
    database.close()
    const reopened = new SessionDatabase({ getUserDataPath: () => directory })
    databases.push(reopened)
    await reopened.initialize()
    const restored = new SessionRuntimeService({ database: reopened })
    restored.recoverInterruptedRuns()
    expect(restored.loadSession(session.id).messages.at(-1)).toMatchObject({
      role: 'assistant',
      metadata: { completionState: 'stopped' },
      parts: [expect.objectContaining({ type: 'tool-trace', toolCallId: 'read' })]
    })
    expect(restored.loadSession(session.id).recovery).toMatchObject({
      status: 'interrupted',
      canRetry: false,
      blockedReason: expect.any(String)
    })
    expect(() => restored.getRetryProfile(session.id, run.runId)).toThrow(/unknown/i)
  })
})

const prompt = userMessage
async function checkpointSetup() {
  const database = new SessionDatabase({ getUserDataPath: () => ':memory:' })
  databases.push(database)
  await database.initialize()
  const service = new SessionRuntimeService({ database })
  const session = service.createSession({ title: 'Checkpoint', defaultProfile: profile })
  const begin = (requestId: string, retry = false) =>
    service.beginTurn({
      sessionId: session.id,
      requestId,
      userMessage: prompt,
      profile,
      retry
    })
  return { database, service, session, begin }
}

describe('Manual context checkpoints', () => {
  const toolCallAssistant: Extract<ChatProviderMessage, { role: 'assistant' }> = {
    role: 'assistant',
    parts: [
      {
        type: 'tool-call',
        toolCallId: 'read',
        toolName: 'Read',
        argumentsJson: '{"file_path":"a"}'
      }
    ]
  }
  const toolResult = {
    type: 'tool-result' as const,
    toolCallId: 'read',
    toolName: 'Read',
    output: 'contents',
    isError: false
  }
  const toolTrace = {
    toolCallId: 'read',
    toolName: 'Read',
    input: { file_path: 'a' },
    output: 'contents',
    isError: false,
    startedAt: 1,
    finishedAt: 2
  }
  const toolCallSettlement = { index: 1, result: toolResult, trace: toolTrace }

  function runToolTurn(handle: {
    recordModelStep: (step: {
      index: number
      assistant: Extract<ChatProviderMessage, { role: 'assistant' }>
    }) => void
    recordToolExecutionStarted: (execution: {
      index: number
      toolCallId: string
      startedAt: number
    }) => void
    recordToolExecutionSettled: (execution: typeof toolCallSettlement) => void
    complete: (assistant: {
      role: 'assistant'
      parts: Array<{ type: 'text'; text: string }>
    }) => void
  }): void {
    handle.recordModelStep({ index: 1, assistant: toolCallAssistant })
    handle.recordToolExecutionStarted({ index: 1, toolCallId: 'read', startedAt: 1 })
    handle.recordToolExecutionSettled(toolCallSettlement)
    handle.recordModelStep({
      index: 2,
      assistant: { role: 'assistant', parts: [{ type: 'text', text: 'Final answer.' }] }
    })
    handle.complete({ role: 'assistant', parts: [{ type: 'text', text: 'Final answer.' }] })
  }

  function acceptCheckpoint(
    service: SessionRuntimeService,
    sessionId: string,
    summary: string
  ): { checkpointEventId: string } {
    const source = service.getCompactionSource(sessionId)
    if (!source) throw new Error('Expected a compaction source.')
    return service.acceptContextCheckpoint({
      sessionId,
      summary,
      coverage: { throughSequence: source.throughSequence },
      sourceDigest: source.sourceDigest
    })
  }

  it('user restarts when a checkpoint covers earlier turns, then summary and tool tail replay', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mico-checkpoint-restart-'))
    paths.push(directory)
    const database = new SessionDatabase({ getUserDataPath: () => directory })
    await database.initialize()
    const service = new SessionRuntimeService({ database })
    const session = service.createSession({ title: 'Checkpoint', defaultProfile: profile })
    const first = service.beginTurn({
      sessionId: session.id,
      requestId: 'first',
      userMessage: prompt,
      profile,
      retry: false
    })
    runToolTurn(first)
    const accepted = acceptCheckpoint(service, session.id, 'Earlier turns summarized.')
    expect(acceptCheckpoint(service, session.id, 'Earlier turns summarized.')).toEqual(accepted)
    expect(() => acceptCheckpoint(service, session.id, 'Different summary.')).toThrow(
      /already exists/i
    )
    const tail = service.beginTurn({
      sessionId: session.id,
      requestId: 'tail',
      userMessage: prompt,
      profile,
      retry: false
    })
    runToolTurn(tail)
    const transcript = service.loadSession(session.id).messages
    database.close()

    const reopened = new SessionDatabase({ getUserDataPath: () => directory })
    databases.push(reopened)
    await reopened.initialize()
    const runtime = new SessionRuntimeService({ database: reopened })
    expect(runtime.loadSession(session.id).messages).toEqual(transcript)
    const next = runtime.beginTurn({
      sessionId: session.id,
      requestId: 'next',
      userMessage: prompt,
      profile,
      retry: false
    })
    expect(next.replayMessages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Earlier turns summarized.' }] },
      prompt,
      toolCallAssistant,
      { role: 'tool', parts: [toolResult] },
      { role: 'assistant', parts: [{ type: 'text', text: 'Final answer.' }] },
      prompt
    ])
    expect(next.contextMessages).toBeUndefined()
  })

  it('user retries when a newer checkpoint exists, then the original pin stays unchanged', async () => {
    const { service, session, begin } = await checkpointSetup()
    begin('covered').complete({ role: 'assistant', parts: [{ type: 'text', text: 'Old history' }] })
    acceptCheckpoint(service, session.id, 'Original summary.')
    const first = begin('first')
    first.complete({ role: 'assistant', parts: [{ type: 'text', text: 'First answer.' }] })
    const second = begin('second')
    second.recordModelStep({
      index: 1,
      assistant: { role: 'assistant', parts: [{ type: 'text', text: 'Partial.' }] }
    })
    second.fail({ code: 'provider_error', message: 'Offline' })
    acceptCheckpoint(service, session.id, 'Covered.')
    const retry = begin('retry', true)
    expect(retry.replayMessages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Original summary.' }] },
      prompt,
      { role: 'assistant', parts: [{ type: 'text', text: 'First answer.' }] },
      prompt,
      { role: 'assistant', parts: [{ type: 'text', text: 'Partial.' }] }
    ])
    retry.complete({ role: 'assistant', parts: [{ type: 'text', text: 'Retry answer.' }] })
    const third = begin('third')
    expect(third.replayMessages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Covered.' }] },
      prompt,
      { role: 'assistant', parts: [{ type: 'text', text: 'Partial.' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'Retry answer.' }] },
      prompt
    ])
  })

  it('user continues when legacy history is compacted, then summary and legacy tail replay', async () => {
    const { service, session, begin } = await checkpointSetup()
    const covered = begin('covered')
    covered.complete({ role: 'assistant', parts: [{ type: 'text', text: 'Covered answer.' }] })
    acceptCheckpoint(service, session.id, 'Legacy covered.')
    const handle = begin('first')
    handle.recordStep({ index: 1, assistant: toolCallAssistant, toolResults: [toolResult] })
    handle.complete({
      role: 'assistant',
      parts: [{ type: 'text', text: 'Final answer.' }]
    })
    expect(begin('next').replayMessages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Legacy covered.' }] },
      prompt,
      toolCallAssistant,
      { role: 'tool', parts: [toolResult] },
      { role: 'assistant', parts: [{ type: 'text', text: 'Final answer.' }] },
      prompt
    ])
  })

  it('user compacts when a run is active, then acceptance is rejected', async () => {
    const { service, session, begin } = await checkpointSetup()
    const first = begin('first')
    first.complete({ role: 'assistant', parts: [{ type: 'text', text: 'First answer.' }] })
    const source = service.getCompactionSource(session.id)
    if (!source) throw new Error('Expected a compaction source.')
    begin('second')
    expect(() =>
      service.acceptContextCheckpoint({
        sessionId: session.id,
        summary: 'Summary.',
        coverage: { throughSequence: source.throughSequence },
        sourceDigest: source.sourceDigest
      })
    ).toThrow(/active run/i)
  })

  it('user cannot accept a checkpoint when the latest turn has an unknown tool outcome, then the recovery reason explains the block', async () => {
    const { service, session, begin } = await checkpointSetup()
    const first = begin('first')
    first.complete({ role: 'assistant', parts: [{ type: 'text', text: 'First answer.' }] })
    const second = begin('second')
    second.recordModelStep({ index: 1, assistant: toolCallAssistant })
    second.recordToolExecutionStarted({ index: 1, toolCallId: 'read', startedAt: 1 })
    second.fail({ code: 'provider_error', message: 'Offline' })
    const source = service.getCompactionSource(session.id)
    if (!source) throw new Error('Expected a compaction source.')
    expect(() =>
      service.acceptContextCheckpoint({
        sessionId: session.id,
        summary: 'Summary.',
        coverage: { throughSequence: source.throughSequence },
        sourceDigest: source.sourceDigest
      })
    ).toThrow(new Error(service.loadSession(session.id).recovery?.blockedReason))
  })

  it('user accepts when coverage is incomplete or stale, then the checkpoint is rejected', async () => {
    const { service, session, begin } = await checkpointSetup()
    const handle = begin('first')
    handle.recordModelStep({ index: 1, assistant: toolCallAssistant })
    handle.recordToolExecutionStarted({ index: 1, toolCallId: 'read', startedAt: 1 })
    handle.recordToolExecutionSettled(toolCallSettlement)
    handle.complete({
      role: 'assistant',
      parts: [{ type: 'text', text: 'Final answer.' }]
    })
    const source = service.getCompactionSource(session.id)
    if (!source) throw new Error('Expected a compaction source.')
    expect(() =>
      service.acceptContextCheckpoint({
        sessionId: session.id,
        summary: 'Summary.',
        coverage: { throughSequence: source.throughSequence - 1 },
        sourceDigest: source.sourceDigest
      })
    ).toThrow(/boundary/i)
    expect(() =>
      service.acceptContextCheckpoint({
        sessionId: session.id,
        summary: 'Summary.',
        coverage: { throughSequence: source.throughSequence },
        sourceDigest: 'f'.repeat(64)
      })
    ).toThrow(/digest/i)
  })

  it('user compacts twice when more accepted turns accumulate, then derived checkpoint events stay out of the raw source digest', async () => {
    const { database, service, session, begin } = await checkpointSetup()
    const first = begin('first')
    first.complete({ role: 'assistant', parts: [{ type: 'text', text: 'First answer.' }] })
    acceptCheckpoint(service, session.id, 'First summary.')
    const second = begin('second')
    second.complete({ role: 'assistant', parts: [{ type: 'text', text: 'Second answer.' }] })
    const source = service.getCompactionSource(session.id)
    if (!source) throw new Error('Expected a compaction source.')
    const rawCount = database.connection
      .prepare(
        "SELECT COUNT(*) FROM runtime_events WHERE session_id = ? AND session_sequence <= ? AND kind <> 'context_checkpoint_recorded'"
      )
      .pluck()
      .get(session.id, source.throughSequence)
    expect(source.events.every((event) => event.kind !== 'context_checkpoint_recorded')).toBe(true)
    expect(source.events).toHaveLength(Number(rawCount))
    acceptCheckpoint(service, session.id, 'Second summary.')
    expect(begin('third').replayMessages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Second summary.' }] },
      prompt
    ])
  })

  it.each(['missing', 'schema', 'checkpoint-digest', 'source-digest', 'source-sequence'] as const)(
    'user resumes when pinned history has %s corruption, then replay fails loudly',
    async (corruption) => {
      const { database, service, session, begin } = await checkpointSetup()
      begin('first').complete({ role: 'assistant', parts: [{ type: 'text', text: 'Covered' }] })
      const { checkpointEventId } = acceptCheckpoint(service, session.id, 'Summary.')
      const next = begin('next')
      // SAFETY: the real startTurn fixture recorded a user event with a string primary key.
      const sourceId = database.connection
        .prepare(
          "SELECT id FROM runtime_events WHERE session_id = ? AND kind = 'user_message_recorded' ORDER BY session_sequence LIMIT 1"
        )
        .pluck()
        .get(session.id) as string
      const writePayload = (id: string, payload: string) =>
        database.connection
          .prepare('UPDATE runtime_events SET payload_json = ?, payload_digest = ? WHERE id = ?')
          .run(payload, createHash('sha256').update(payload).digest('hex'), id)
      if (corruption === 'missing') {
        // Simulated on-disk corruption bypasses referential guards exactly like real bit rot.
        database.connection.pragma('foreign_keys = OFF')
        database.connection
          .prepare('DELETE FROM runtime_events WHERE id = ?')
          .run(checkpointEventId)
        database.connection.pragma('foreign_keys = ON')
      } else if (corruption === 'schema') writePayload(checkpointEventId, '{}')
      else if (corruption === 'checkpoint-digest')
        database.connection
          .prepare('UPDATE runtime_events SET payload_json = ? WHERE id = ?')
          .run('{}', checkpointEventId)
      else if (corruption === 'source-digest') writePayload(sourceId, '{}')
      else
        database.connection
          .prepare('UPDATE runtime_events SET session_sequence = ? WHERE id = ?')
          .run(0, sourceId)
      expect(() => service.getReplayMessages(next.runId)).toThrow(/checkpoint|digest|JSON/i)
      next.fail({ code: 'provider_error', message: 'Offline' })
      expect(() => begin('corrupt-retry', true)).toThrow(/checkpoint|digest|JSON/i)
      expect(
        database.connection
          .prepare("SELECT COUNT(*) FROM runs WHERE status = 'running'")
          .pluck()
          .get()
      ).toBe(0)
    }
  )

  it('user captures provenance when a settled prefix exists, then its digest matches the three-field contract', async () => {
    const { database, service, session, begin } = await checkpointSetup()
    begin('first').complete({ role: 'assistant', parts: [{ type: 'text', text: 'Covered' }] })
    // SAFETY: the fixed query selects the schema-owned source digest contract columns.
    const rows = database.connection
      .prepare(
        "SELECT session_sequence, kind, payload_digest FROM runtime_events WHERE session_id = ? AND kind NOT IN ('context_checkpoint_recorded', 'compaction_notice_recorded') ORDER BY session_sequence"
      )
      .all(session.id) as { session_sequence: number; kind: string; payload_digest: string }[]
    // Independently serialize canonical keys in lexical order; do not use the production encoder.
    const canonical = `[${rows.map((row) => `{"kind":${JSON.stringify(row.kind)},"payload_digest":${JSON.stringify(row.payload_digest)},"session_sequence":${row.session_sequence}}`).join(',')}]`
    const expected = createHash('sha256').update(canonical).digest('hex')
    expect(service.getCompactionSource(session.id)?.sourceDigest).toBe(expected)
    const checkpoint = acceptCheckpoint(service, session.id, 'Summary.')
    database.connection
      .prepare(
        "UPDATE runtime_events SET id = ? WHERE kind = 'user_message_recorded' AND session_id = ?"
      )
      .run('renamed-source', session.id)
    expect(service.getCompactionSource(session.id)?.sourceDigest).toBe(expected)
    expect(begin('next').replayMessages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Summary.' }] },
      prompt
    ])
    expect(checkpoint.checkpointEventId).toBeTruthy()
  })

  it.each(['cancelled', 'unfinished'] as const)(
    'user compacts when a %s turn lies in the prefix, then acceptance is rejected',
    async (state) => {
      const { database, service, session, begin } = await checkpointSetup()
      const first = begin('first')
      if (state === 'cancelled') first.cancel()
      else first.fail({ code: 'provider_error', message: 'Offline' })
      begin('second').complete({ role: 'assistant', parts: [{ type: 'text', text: 'Done' }] })
      const sequence = database.connection
        .prepare("SELECT MAX(session_sequence) FROM runtime_events WHERE kind = 'run_completed'")
        .pluck()
        .get()
      expect(() =>
        service.acceptContextCheckpoint({
          sessionId: session.id,
          summary: 'Summary.',
          coverage: { throughSequence: Number(sequence) },
          sourceDigest: 'a'.repeat(64)
        })
      ).toThrow(/unsettled|cancelled/i)
      expect(service.getCompactionSource(session.id)).toBeNull()
    }
  )

  it('user accepts when the session does not exist, then checkpoint acceptance rejects', async () => {
    const { service } = await checkpointSetup()
    expect(() =>
      service.acceptContextCheckpoint({
        sessionId: 'missing',
        summary: 'Summary.',
        coverage: { throughSequence: 1 },
        sourceDigest: 'a'.repeat(64)
      })
    ).toThrow('Session does not exist.')
  })

  it.each([
    { summary: '   ' },
    { summary: 'x'.repeat(100_001) },
    { coverage: { throughSequence: 0 } },
    { coverage: { throughSequence: -1 } },
    { coverage: { throughSequence: 1.5 } },
    { sourceDigest: 'invalid' },
    { sourceDigest: 'g'.repeat(64) },
    { sourceDigest: 'a'.repeat(63) }
  ])(
    'user accepts when checkpoint input is invalid (%#), then schema validation rejects',
    async (invalid) => {
      const { service, session, begin } = await checkpointSetup()
      begin('first').complete({ role: 'assistant', parts: [{ type: 'text', text: 'Done' }] })
      const source = service.getCompactionSource(session.id)
      if (!source) throw new Error('Expected a compaction source.')
      expect(() =>
        service.acceptContextCheckpoint({
          sessionId: session.id,
          summary: 'Summary.',
          coverage: { throughSequence: source.throughSequence },
          sourceDigest: source.sourceDigest,
          ...invalid
        })
      ).toThrow(/too_small|too_big|invalid|custom/i)
    }
  )

  it('user captures a compaction source when storage is damaged, then the storage error propagates', async () => {
    const { database, service, session, begin } = await checkpointSetup()
    begin('first').complete({ role: 'assistant', parts: [{ type: 'text', text: 'Covered' }] })
    // The boundary-discovery query still succeeds, while the subsequent runs query
    // encounters real SQLite schema damage inside boundary validation.
    database.connection.exec('ALTER TABLE runs RENAME TO damaged_runs')
    expect(() => service.getCompactionSource(session.id)).toThrow('no such table: runs')
  })

  it('user captures a repeated compaction when a pinned summary exists, then source messages reuse that summary', async () => {
    const { service, session, begin } = await checkpointSetup()
    begin('first').complete({ role: 'assistant', parts: [{ type: 'text', text: 'Covered' }] })
    acceptCheckpoint(service, session.id, 'First summary.')
    const second = begin('second')
    second.recordContext([])
    second.complete({ role: 'assistant', parts: [{ type: 'text', text: 'Tail answer' }] })
    expect(service.getCompactionSource(session.id)?.messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'First summary.' }] },
      userMessage,
      { role: 'assistant', parts: [{ type: 'text', text: 'Tail answer' }] }
    ])
  })
})
