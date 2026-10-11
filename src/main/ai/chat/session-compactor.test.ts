import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ChatProvider, type ProviderStreamPart, providerFinish } from '@mico/ai-providers'
import type { UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionDatabase } from '../../data/session-database'
import {
  type ExecutionProfileSnapshot,
  SessionRuntimeService
} from '../sessions/session-runtime-service'
import { SessionCompactor } from './session-compactor'
import { SessionModelProfile } from './session-model-profile'

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
})

function textDelta(delta: string): UIMessageChunk {
  return { type: 'text-delta', id: 'text-1', delta }
}

function toolCallChunk(): UIMessageChunk {
  return { type: 'tool-input-available', toolCallId: 'call-1', toolName: 'Read', input: {} }
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
  compactor: SessionCompactor
  streamCalls: Parameters<ChatProvider['stream']>[0][]
  isCompacting: (sessionId: string) => boolean
}

async function createHarness(
  options: { stream?: ChatProvider['stream']; maxSummaryChars?: number } = {}
): Promise<Harness> {
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
  const compactor = createCompactor({ runtime, stream, maxSummaryChars: options.maxSummaryChars })
  return {
    database,
    runtime,
    session,
    compactor,
    streamCalls,
    isCompacting: (sessionId) => compactor.isCompacting(sessionId)
  }
}

function createCompactor({
  runtime,
  stream,
  maxSummaryChars
}: {
  runtime: SessionRuntimeService
  stream: ChatProvider['stream']
  maxSummaryChars?: number
}): SessionCompactor {
  return new SessionCompactor({
    runtime,
    modelProfile: new SessionModelProfile({
      resolveProvider: () => createProvider(stream),
      getChatConfigurationForModelEntry: () => configuration,
      getSelectedChatConfiguration: () => configuration,
      runtime
    }),
    maxSummaryChars
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

describe('SessionCompactor', () => {
  it('user summarizes when turns are completed, then the accepted checkpoint pins the covered boundary', async () => {
    const { database, runtime, session, compactor, streamCalls } = await createHarness()
    const first = beginTurn(runtime, session.id, 'first')
    first.recordModelStep({
      index: 1,
      assistant: {
        role: 'assistant',
        parts: [
          {
            type: 'reasoning',
            text: 'SECRET-REASONING',
            providerMetadata: { ollama: { signature: 'sig' } }
          },
          { type: 'text', text: 'First answer.' }
        ]
      }
    })
    first.complete(assistantMessage)
    completeTurn(runtime, session.id, 'second')

    const outcome = await compactor.compact(session.id)

    expect(outcome.status).toBe('accepted')
    if (outcome.status !== 'accepted') throw new Error('Expected an accepted outcome.')
    expect(streamCalls).toHaveLength(1)
    const request = streamCalls[0]
    expect(request.thinkingEffort).toBe('none')
    expect(request.tools).toBeUndefined()
    expect(request.signal).toBeInstanceOf(AbortSignal)
    expect(request.messages).toHaveLength(2)
    expect(request.messages[0]?.role).toBe('system')
    const transcript = request.messages[1]
    if (transcript.role !== 'user') throw new Error('Expected a user transcript message.')
    const transcriptText = transcript.parts
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('\n')
    expect(transcriptText).toContain('Inspect the failing test')
    expect(transcriptText).toContain('First answer.')
    expect(transcriptText).not.toContain('SECRET-REASONING')
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

  it('user requests a summary when no turns are completed, then the request is refused directly', async () => {
    const { session, compactor } = await createHarness()
    await expect(compactor.compact(session.id)).rejects.toThrow(/no completed turns/i)
  })

  it.each([
    {
      name: 'a length finish',
      parts: [textDelta('Partial.'), providerFinish({ reason: 'length' })]
    },
    {
      name: 'a tool-call finish',
      parts: [textDelta('Running'), providerFinish({ reason: 'tool-calls' })]
    },
    {
      name: 'an unknown finish',
      parts: [textDelta('Odd.'), providerFinish({ reason: 'unknown' })]
    },
    {
      name: 'a content-filter finish',
      parts: [textDelta('Blocked.'), providerFinish({ reason: 'content-filter' })]
    },
    { name: 'a provider-side cancel finish', parts: [providerFinish({ reason: 'cancelled' })] },
    { name: 'a tool-call part', parts: [toolCallChunk(), providerFinish({ reason: 'stop' })] },
    { name: 'an empty output', parts: [providerFinish({ reason: 'stop' })] },
    {
      name: 'whitespace-only output',
      parts: [textDelta('   '), providerFinish({ reason: 'stop' })]
    },
    { name: 'an incomplete stream', parts: [textDelta('Partial.')] }
  ])(
    'user receives a summary when it ends with $name, then the rejection becomes a durable notice without a checkpoint',
    async ({ parts }) => {
      const { database, runtime, session, compactor, streamCalls } = await createHarness({
        stream: async () => streamFrom(parts)
      })
      completeTurn(runtime, session.id, 'first')

      const outcome = await compactor.compact(session.id)

      expect(outcome.status).toBe('failed')
      if (outcome.status !== 'failed') throw new Error('Expected a failed outcome.')
      expect(outcome.message).toMatch(/summary/i)
      const recorded = notices(database, session.id)
      expect(recorded).toHaveLength(1)
      expect(recorded[0]?.reason).toBe('rejected')
      expect(checkpoints(database, session.id)).toEqual([])
      expect(streamCalls).toHaveLength(1)
    }
  )

  it('user receives a summary when it exceeds the length bound, then the overlong output is rejected', async () => {
    const { database, runtime, session, compactor } = await createHarness({
      maxSummaryChars: 10,
      stream: async () => summaryStream('a'.repeat(40))
    })
    completeTurn(runtime, session.id, 'first')

    const outcome = await compactor.compact(session.id)

    expect(outcome.status).toBe('failed')
    expect(notices(database, session.id)[0]?.reason).toBe('rejected')
    expect(checkpoints(database, session.id)).toEqual([])
  })

  it('user changes covered history when a summary runs, then the stale summary is discarded with a durable notice', async () => {
    const { database, runtime, session } = await createHarness()
    completeTurn(runtime, session.id, 'first')
    const { stream, resolve } = deferredStream()
    const deferredCompactor = createCompactor({ runtime, stream })

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

  it('user changes the session model when a summary runs, then the summary is discarded with a durable notice', async () => {
    const { database, runtime, session } = await createHarness()
    completeTurn(runtime, session.id, 'first')
    const { stream, resolve } = deferredStream()
    const compactor = createCompactor({ runtime, stream })

    const pending = compactor.compact(session.id)
    runtime.updateDefaultProfile(session.id, { ...profile, thinkingEffort: 'low' })
    resolve([textDelta('Summary.'), providerFinish({ reason: 'stop' })])

    const outcome = await pending

    expect(outcome.status).toBe('failed')
    expect(notices(database, session.id)[0]?.reason).toBe('profile_changed')
    expect(checkpoints(database, session.id)).toEqual([])
  })

  it('user cancels a summary when acquisition is pending, then cancellation is acknowledged durably', async () => {
    const { database, runtime, session } = await createHarness()
    completeTurn(runtime, session.id, 'first')
    const { stream, resolve } = deferredStream()
    const compactor = createCompactor({ runtime, stream })

    const pending = compactor.compact(session.id)
    const cancellation = compactor.cancel(session.id)
    resolve([textDelta('Summary.'), providerFinish({ reason: 'stop' })])
    await cancellation

    const outcome = await pending

    expect(outcome).toEqual({ status: 'cancelled' })
    expect(notices(database, session.id)[0]?.reason).toBe('cancelled')
    expect(checkpoints(database, session.id)).toEqual([])
  })

  it('user cancels a summary when it is streaming, then cancellation wins over the pending output', async () => {
    const { runtime, session } = await createHarness()
    completeTurn(runtime, session.id, 'first')
    const streamedFirstPart = createDeferred<void>()
    const releaseRest = createDeferred<void>()
    const stream: ChatProvider['stream'] = async () =>
      (async function* () {
        yield textDelta('Partial.')
        streamedFirstPart.resolve()
        await releaseRest.promise
        yield providerFinish({ reason: 'stop' })
      })()
    const compactor = createCompactor({ runtime, stream })

    const pending = compactor.compact(session.id)
    await streamedFirstPart.promise
    const cancellation = compactor.cancel(session.id)
    releaseRest.resolve()
    await cancellation

    await expect(pending).resolves.toEqual({ status: 'cancelled' })
  })

  it('user starts two summaries when one session is selected, then the second request is refused', async () => {
    const { runtime, session } = await createHarness()
    completeTurn(runtime, session.id, 'first')
    const { stream, resolve } = deferredStream()
    const compactor = createCompactor({ runtime, stream })

    const pending = compactor.compact(session.id)
    await expect(compactor.compact(session.id)).rejects.toThrow(/already running/i)

    resolve([textDelta('Summary.'), providerFinish({ reason: 'stop' })])
    await expect(pending).resolves.toEqual({
      status: 'accepted',
      checkpointEventId: expect.any(String)
    })
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
    const compactor = createCompactor({ runtime, stream })

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
    const compactor = createCompactor({
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
      { role: 'user', parts: [{ type: 'text', text: 'Accepted summary.' }] },
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
    const compactor = createCompactor({ runtime, stream })

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
    let currentConfiguration = configuration
    const compactor = new SessionCompactor({
      runtime,
      modelProfile: new SessionModelProfile({
        resolveProvider: () => createProvider(deferred.stream),
        getChatConfigurationForModelEntry: () => currentConfiguration,
        runtime
      })
    })
    const capturedProfile = runtime.getDefaultProfile(session.id)
    const pending = compactor.compact(session.id)
    currentConfiguration = { ...configuration, baseUrl: 'http://localhost:11435' }
    deferred.resolve([textDelta('Summary.'), providerFinish({ reason: 'stop' })])
    await expect(pending).resolves.toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/provider configuration changed/i)
    })
    expect(runtime.getDefaultProfile(session.id)).toEqual(capturedProfile)
    expect(notices(database, session.id)[0]?.reason).toBe('profile_changed')
    expect(checkpoints(database, session.id)).toEqual([])
  })

  it('user quits when one notice failed earlier and another is pending, then drain waits and reports both failures once', async () => {
    const { database, runtime, session } = await createHarness()
    const second = runtime.createSession({ title: 'Second', defaultProfile: profile })
    completeTurn(runtime, session.id, 'first')
    completeTurn(runtime, second.id, 'second')
    database.connection.exec(`CREATE TRIGGER reject_compaction_notices BEFORE INSERT ON runtime_events
      WHEN NEW.kind = 'compaction_notice_recorded'
      BEGIN SELECT RAISE(FAIL, 'notice persistence failed'); END;`)
    const firstStream = deferredStream()
    const secondStream = deferredStream()
    let requestCount = 0
    const compactor = createCompactor({
      runtime,
      stream: (input) => {
        requestCount += 1
        return (requestCount === 1 ? firstStream.stream : secondStream.stream)(input)
      }
    })
    const first = compactor.compact(session.id)
    firstStream.resolve([providerFinish({ reason: 'length' })])
    await expect(first).rejects.toThrow('notice persistence failed')
    expect(compactor.isCompacting(session.id)).toBe(false)
    expect(() => beginTurn(runtime, session.id, 'after-failure')).not.toThrow()
    const pendingSecond = compactor.compact(second.id)
    compactor.dispose()
    let didDrainSettle = false
    const draining = compactor.drain().then(
      () => {
        didDrainSettle = true
        return null
      },
      (error: Error) => {
        didDrainSettle = true
        return error
      }
    )
    await Promise.resolve()
    expect(didDrainSettle).toBe(false)
    secondStream.resolve([providerFinish({ reason: 'stop' })])
    await expect(pendingSecond).rejects.toThrow('notice persistence failed')
    const error = await draining
    expect(error).toBeInstanceOf(AggregateError)
    if (!(error instanceof AggregateError))
      throw new Error('Expected aggregated persistence failures.')
    expect(error.errors).toHaveLength(2)
    expect(error.errors.map((failure: Error) => failure.message)).toEqual([
      'notice persistence failed',
      'notice persistence failed'
    ])
    expect(compactor.isCompacting(second.id)).toBe(false)
    await expect(compactor.drain()).resolves.toBeUndefined()
  })

  it('user restarts when a rejected summary finishes, then the next summary starts immediately after await', async () => {
    const { runtime, session } = await createHarness()
    completeTurn(runtime, session.id, 'first')
    const compactor = createCompactor({
      runtime,
      stream: async () => streamFrom([providerFinish({ reason: 'length' })])
    })
    await compactor.compact(session.id)
    expect(compactor.isCompacting(session.id)).toBe(false)
    await expect(compactor.compact(session.id)).resolves.toMatchObject({ status: 'failed' })
  })

  it('user retries when notice storage keeps failing, then drain reports the total with bounded error samples once', async () => {
    const { database, runtime, session } = await createHarness()
    completeTurn(runtime, session.id, 'first')
    database.connection.exec(`CREATE TRIGGER reject_repeated_notices BEFORE INSERT ON runtime_events
      WHEN NEW.kind = 'compaction_notice_recorded'
      BEGIN SELECT RAISE(FAIL, 'repeated notice failure'); END;`)
    const compactor = createCompactor({
      runtime,
      stream: async () => streamFrom([providerFinish({ reason: 'length' })])
    })
    const attemptCount = 100
    for (let attempt = 0; attempt < attemptCount; attempt += 1) {
      await expect(compactor.compact(session.id)).rejects.toThrow('repeated notice failure')
    }
    const failure = await compactor.drain().catch((error: Error) => error)
    expect(failure).toBeInstanceOf(AggregateError)
    if (!(failure instanceof AggregateError))
      throw new Error('Expected persistence failure aggregate.')
    expect(failure.message).toContain('100')
    expect(failure.errors.length).toBeGreaterThan(0)
    expect(failure.errors.length).toBeLessThan(attemptCount)
    await expect(compactor.drain()).resolves.toBeUndefined()
  })

  it('user hits a storage failure when a rejection notice is written, then the failure propagates and the gate releases', async () => {
    const { database, runtime, session } = await createHarness()
    completeTurn(runtime, session.id, 'first')
    const { stream, resolve } = deferredStream()
    const compactor = createCompactor({ runtime, stream })

    const pending = compactor.compact(session.id)
    database.close()
    resolve([textDelta('Partial.'), providerFinish({ reason: 'length' })])

    await expect(pending).rejects.toThrow(/database/i)
    expect(compactor.isCompacting(session.id)).toBe(false)
  })
})
