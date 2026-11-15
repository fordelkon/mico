import { CodingAgent } from '@mico/coding-agent'
import { PermissionRequests } from './tool-approvals'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ChatProvider, type ProviderStreamPart, providerFinish } from '@mico/ai-providers'
import type { UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionDatabase } from '@main/data/session-database'
import { type ExecutionProfileSnapshot, SessionRuntimeService } from './runtime'
import { createModels, removeTemporaryPaths } from './test-helpers'

const profile: ExecutionProfileSnapshot = {
  modelEntryId: 'ollama:qwen3',
  providerId: 'ollama',
  modelId: 'qwen3:8b',
  thinkingEffort: 'default',
  configurationDigest: 'configuration-digest'
}

const configuration = {
  provider: 'ollama' as const,
  baseUrl: 'http://localhost:11434',
  modelId: 'qwen3:8b'
}

const userMessage = {
  role: 'user' as const,
  parts: [{ type: 'text' as const, text: 'Inspect the failing test' }]
}
const assistantMessage = {
  role: 'assistant' as const,
  parts: [{ type: 'text' as const, text: 'First answer.' }]
}

const databases: SessionDatabase[] = []
const paths: string[] = []
afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  await removeTemporaryPaths()
})

function textDelta(delta: string): UIMessageChunk {
  return { type: 'text-delta', id: 'text-1', delta }
}

function streamFrom(parts: ProviderStreamPart[]): AsyncIterable<ProviderStreamPart> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<ProviderStreamPart> {
      yield* parts
    }
  }
}

function summaryStream(text: string): AsyncIterable<ProviderStreamPart> {
  return streamFrom([textDelta(text), providerFinish({ reason: 'stop' })])
}

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function createProvider(stream: ChatProvider['stream']): ChatProvider {
  return { getModelCapabilities: () => Promise.resolve(null), stream }
}

/** Streams whose acquisition the test controls, so cancellation can race the request. */
function deferredStream() {
  const deferred = createDeferred<ProviderStreamPart[]>()
  const stream: ChatProvider['stream'] = async () => streamFrom(await deferred.promise)
  return { stream, resolve: deferred.resolve }
}

type Harness = {
  database: SessionDatabase
  runtime: SessionRuntimeService
  session: ReturnType<SessionRuntimeService['createSession']>
  compactor: CodingAgent
  streamCalls: Parameters<ChatProvider['stream']>[0][]
}

async function createHarness(options: { stream?: ChatProvider['stream'] } = {}): Promise<Harness> {
  const database = new SessionDatabase({ getUserDataPath: () => ':memory:' })
  databases.push(database)
  await database.initialize()
  const runtime = new SessionRuntimeService({ database })
  const session = runtime.createSession({ title: 'Session', defaultProfile: profile })
  const streamCalls: Parameters<ChatProvider['stream']>[0][] = []
  const stream: ChatProvider['stream'] = async (input) => {
    streamCalls.push(input)
    const delegate = options.stream ?? (() => summaryStream('Summary.'))
    return delegate(input)
  }
  const compactor = await createCompactor({ runtime, stream })
  return {
    database,
    runtime,
    session,
    compactor,
    streamCalls
  }
}

async function createCompactor({
  runtime,
  stream
}: {
  runtime: SessionRuntimeService
  stream: ChatProvider['stream']
}): Promise<CodingAgent> {
  const models = await createModels(() => createProvider(stream), configuration)
  return new CodingAgent({
    runtime,
    models,
    requestApproval: new PermissionRequests().request
  })
}

function beginTurn(
  runtime: SessionRuntimeService,
  sessionId: string,
  requestId: string
): ReturnType<SessionRuntimeService['beginTurn']> {
  return runtime.beginTurn({ sessionId, requestId, userMessage, profile, retry: false })
}

function completeTurn(runtime: SessionRuntimeService, sessionId: string, requestId: string): void {
  beginTurn(runtime, sessionId, requestId).complete(assistantMessage)
}

function completeToolTurn(runtime: SessionRuntimeService, sessionId: string, output: string): void {
  const handle = beginTurn(runtime, sessionId, 'large-result')
  handle.recordStep({
    index: 1,
    assistant: {
      role: 'assistant',
      parts: [{ type: 'tool-call', toolCallId: 'read', toolName: 'Read', argumentsJson: '{}' }]
    },
    toolResults: [
      { type: 'tool-result', toolCallId: 'read', toolName: 'Read', output, isError: false }
    ]
  })
  handle.complete(assistantMessage)
}

type CheckpointPayload = {
  trigger: 'manual'
  summary: string
  coverage: { throughSequence: number }
  sourceDigest: string
}

type NoticePayload = {
  reason: string
  message: string
  coverage: { throughSequence: number }
  sourceDigest: string
}

function payloadRows<T>(database: SessionDatabase, sessionId: string, kind: string): T[] {
  // SAFETY: the fixed SELECT returns schema-owned payload_json columns.
  return (
    (
      database.connection
        .prepare(
          'SELECT payload_json FROM runtime_events WHERE session_id = ? AND kind = ? ORDER BY session_sequence'
        )
        .all(sessionId, kind) as { payload_json: string }[]
    )
      // SAFETY: the selected kind identifies payloads written by the runtime owner.
      .map((row) => JSON.parse(row.payload_json) as T)
  )
}

function checkpoints(database: SessionDatabase, sessionId: string): CheckpointPayload[] {
  return payloadRows<CheckpointPayload>(database, sessionId, 'context_checkpoint_recorded')
}

function notices(database: SessionDatabase, sessionId: string): NoticePayload[] {
  return payloadRows<NoticePayload>(database, sessionId, 'compaction_notice_recorded')
}

describe('Desktop compaction integration', () => {
  it('user summarizes when turns are completed, then the accepted checkpoint pins the covered boundary', async () => {
    const { database, runtime, session, compactor } = await createHarness()
    completeTurn(runtime, session.id, 'first')
    completeTurn(runtime, session.id, 'second')

    const outcome = await compactor.compact(session.id)

    expect(outcome.status).toBe('accepted')
    if (outcome.status !== 'accepted') throw new Error('Expected an accepted outcome.')
    expect(checkpoints(database, session.id)).toEqual([
      {
        trigger: 'manual',
        summary: 'Summary.',
        coverage: { throughSequence: expect.any(Number) },
        sourceDigest: expect.any(String)
      }
    ])
    expect(notices(database, session.id)).toEqual([])
    beginTurn(runtime, session.id, 'after-summary')
    // SAFETY: the fixed SELECT returns the schema-owned checkpoint pin.
    const pinnedTurn = database.connection
      .prepare(
        'SELECT checkpoint_event_id FROM turns WHERE session_id = ? ORDER BY ordinal DESC LIMIT 1'
      )
      .get(session.id) as { checkpoint_event_id: string | null }
    expect(pinnedTurn.checkpoint_event_id).toBe(outcome.checkpointEventId)
  })

  it('user receives an incomplete summary when generation ends early, then a rejection notice is stored without a checkpoint', async () => {
    const { database, runtime, session, compactor } = await createHarness({
      stream: async () => streamFrom([textDelta('Partial.'), providerFinish({ reason: 'length' })])
    })
    completeTurn(runtime, session.id, 'first')

    await expect(compactor.compact(session.id)).resolves.toMatchObject({ status: 'failed' })

    expect(notices(database, session.id)).toEqual([expect.objectContaining({ reason: 'rejected' })])
    expect(checkpoints(database, session.id)).toEqual([])
  })

  it('user summarizes oversized history when the input exceeds its byte budget, then history remains intact', async () => {
    const { database, runtime, session, compactor, streamCalls } = await createHarness()
    const output = '界'.repeat(400_000)
    completeToolTurn(runtime, session.id, output)
    const original = runtime.getCompactionSource(session.id)

    await expect(compactor.compact(session.id)).resolves.toMatchObject({
      status: 'failed',
      message: expect.stringContaining('1 MiB')
    })

    expect(streamCalls).toHaveLength(0)
    expect(checkpoints(database, session.id)).toEqual([])
    expect(notices(database, session.id)).toEqual([
      expect.objectContaining({ reason: 'rejected', sourceDigest: original?.sourceDigest })
    ])
    expect(runtime.getCompactionSource(session.id)?.messages).toEqual(original?.messages)
    expect(() => beginTurn(runtime, session.id, 'after-refusal')).not.toThrow()
  })

  it('user changes covered history when a summary runs, then the stale summary is discarded with a durable notice', async () => {
    const { database, runtime, session } = await createHarness()
    completeTurn(runtime, session.id, 'first')
    const { stream, resolve } = deferredStream()
    const deferredCompactor = await createCompactor({ runtime, stream })

    const pending = deferredCompactor.compact(session.id)
    const payload = JSON.stringify({
      message: { ...assistantMessage, parts: [{ type: 'text', text: 'Changed answer.' }] }
    })
    database.connection
      .prepare(
        "UPDATE runtime_events SET payload_json = ?, payload_digest = ? WHERE session_id = ? AND kind = 'assistant_output_finalized'"
      )
      .run(payload, createHash('sha256').update(payload).digest('hex'), session.id)
    resolve([textDelta('Summary.'), providerFinish({ reason: 'stop' })])

    const outcome = await pending

    expect(outcome.status).toBe('failed')
    if (outcome.status !== 'failed') throw new Error('Expected a failed outcome.')
    expect(outcome.message).toMatch(/changed/i)
    expect(notices(database, session.id)[0]?.reason).toBe('source_changed')
    expect(checkpoints(database, session.id)).toEqual([])
  })

  it('user cancels a summary when acquisition is pending, then cancellation is acknowledged durably', async () => {
    const { database, runtime, session } = await createHarness()
    completeTurn(runtime, session.id, 'first')
    const { stream, resolve } = deferredStream()
    const compactor = await createCompactor({ runtime, stream })

    const pending = compactor.compact(session.id)
    const cancellation = compactor.cancelCompaction(session.id)
    resolve([textDelta('Summary.'), providerFinish({ reason: 'stop' })])
    await cancellation

    const outcome = await pending

    expect(outcome).toEqual({ status: 'cancelled' })
    expect(notices(database, session.id)[0]?.reason).toBe('cancelled')
    expect(checkpoints(database, session.id)).toEqual([])
  })

  it('user summarizes when a chat run is active, then compaction respects the active-run gate', async () => {
    const { runtime, session, compactor } = await createHarness()
    completeTurn(runtime, session.id, 'first')
    const running = beginTurn(runtime, session.id, 'second')

    await expect(compactor.compact(session.id)).rejects.toThrow(/active run/i)

    running.complete(assistantMessage)
    await expect(compactor.compact(session.id)).resolves.toEqual({
      status: 'accepted',
      checkpointEventId: expect.any(String)
    })
  })

  it('user deletes a session when its summary runs, then deletion is refused until the summary settles', async () => {
    const { runtime, session } = await createHarness()
    completeTurn(runtime, session.id, 'first')
    const { stream, resolve } = deferredStream()
    const compactor = await createCompactor({ runtime, stream })

    const pending = compactor.compact(session.id)
    expect(() => runtime.deleteSession(session.id)).toThrow(/summary/i)
    expect(() => beginTurn(runtime, session.id, 'blocked-send')).toThrow(/summary/i)

    resolve([textDelta('Summary.'), providerFinish({ reason: 'stop' })])
    await pending
    expect(() => runtime.deleteSession(session.id)).not.toThrow()
  })

  it('user reopens when a summary was accepted, then its checkpoint replays and raw messages remain', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mico-summary-restart-'))
    paths.push(directory)
    const database = new SessionDatabase({ getUserDataPath: () => directory })
    databases.push(database)
    await database.initialize()
    const runtime = new SessionRuntimeService({ database })
    const session = runtime.createSession({ title: 'Session', defaultProfile: profile })
    completeTurn(runtime, session.id, 'first')
    const transcript = runtime.loadSession(session.id).messages
    const compactor = await createCompactor({
      runtime,
      stream: async () => summaryStream('Accepted summary.')
    })
    await expect(compactor.compact(session.id)).resolves.toMatchObject({ status: 'accepted' })
    database.close()
    const reopened = new SessionDatabase({ getUserDataPath: () => directory })
    databases.push(reopened)
    await reopened.initialize()
    const restarted = new SessionRuntimeService({ database: reopened })
    expect(restarted.loadSession(session.id).messages).toEqual(transcript)
    expect(beginTurn(restarted, session.id, 'next').replayMessages).toEqual([
      {
        role: 'user',
        parts: [{ type: 'text', text: expect.stringContaining('Accepted summary.') }]
      },
      userMessage
    ])
  })

  it('user quits when a summary runs, then disposal drains the cancellation notice before the database closes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mico-compactor-shutdown-'))
    paths.push(directory)
    const database = new SessionDatabase({ getUserDataPath: () => directory })
    databases.push(database)
    await database.initialize()
    const runtime = new SessionRuntimeService({ database })
    const session = runtime.createSession({ title: 'Session', defaultProfile: profile })
    completeTurn(runtime, session.id, 'first')
    const { stream, resolve } = deferredStream()
    const compactor = await createCompactor({ runtime, stream })

    const pending = compactor.compact(session.id)
    compactor.dispose()
    resolve([textDelta('Summary.'), providerFinish({ reason: 'stop' })])

    await compactor.drain()
    await expect(pending).resolves.toEqual({ status: 'cancelled' })
    expect(notices(database, session.id)).toHaveLength(1)

    database.close()
    const reopened = new SessionDatabase({ getUserDataPath: () => directory })
    databases.push(reopened)
    await reopened.initialize()
    expect(notices(reopened, session.id)).toHaveLength(1)
  })

  it('user changes provider settings when a summary runs, then unchanged session history receives a profile notice', async () => {
    const { database, runtime, session } = await createHarness()
    completeTurn(runtime, session.id, 'first')
    const deferred = deferredStream()
    const models = await createModels(() => createProvider(deferred.stream), configuration)
    const compactor = new CodingAgent({
      runtime,
      models,
      requestApproval: new PermissionRequests().request
    })
    const capturedProfile = runtime.getDefaultProfile(session.id)
    const pending = compactor.compact(session.id)
    await models.saveLibrary({
      ...models.getLibrary(),
      configurations: [{ provider: 'ollama', baseUrl: 'http://localhost:11435', enabled: true }]
    })
    deferred.resolve([textDelta('Summary.'), providerFinish({ reason: 'stop' })])
    await expect(pending).resolves.toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/provider configuration changed/i)
    })
    expect(runtime.getDefaultProfile(session.id)).toEqual(capturedProfile)
    expect(notices(database, session.id)[0]?.reason).toBe('profile_changed')
    expect(checkpoints(database, session.id)).toEqual([])
  })

  it('user retries after a notice write fails when storage recovers, then the session accepts another turn and summary', async () => {
    const { database, runtime, session } = await createHarness()
    completeTurn(runtime, session.id, 'first')
    database.connection.exec(`CREATE TRIGGER reject_compaction_notices BEFORE INSERT ON runtime_events
      WHEN NEW.kind = 'compaction_notice_recorded'
      BEGIN SELECT RAISE(FAIL, 'notice persistence failed'); END;`)
    const compactor = await createCompactor({
      runtime,
      stream: async () => streamFrom([providerFinish({ reason: 'length' })])
    })

    await expect(compactor.compact(session.id)).rejects.toThrow('notice persistence failed')
    completeTurn(runtime, session.id, 'after-failure')
    database.connection.exec('DROP TRIGGER reject_compaction_notices')
    await expect(compactor.compact(session.id)).resolves.toMatchObject({ status: 'failed' })

    expect(notices(database, session.id)).toEqual([expect.objectContaining({ reason: 'rejected' })])
    expect(checkpoints(database, session.id)).toEqual([])
    await expect(compactor.drain()).rejects.toThrow(AggregateError)
  })

  it('user loses database access when a rejection notice is written, then the storage failure propagates', async () => {
    const { database, runtime, session } = await createHarness()
    completeTurn(runtime, session.id, 'first')
    const { stream, resolve } = deferredStream()
    const compactor = await createCompactor({ runtime, stream })

    const pending = compactor.compact(session.id)
    database.close()
    resolve([textDelta('Partial.'), providerFinish({ reason: 'length' })])

    await expect(pending).rejects.toThrow(/database/i)
    await expect(compactor.compact(session.id)).rejects.toThrow(/database/i)
  })
})
