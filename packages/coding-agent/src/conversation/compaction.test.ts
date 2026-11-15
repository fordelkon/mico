import { type ChatProvider, type ProviderStreamPart, providerFinish } from '@mico/ai-providers'
import { describe, expect, it, vi } from 'vitest'
import type { ExecutionProfileSnapshot } from '../contracts'
import { SessionCompactor } from './compaction'

type Dependencies = ConstructorParameters<typeof SessionCompactor>[0]
const sessionId = 'session'
const profile: ExecutionProfileSnapshot = {
  modelEntryId: 'model',
  providerId: 'ollama',
  modelId: 'qwen3',
  thinkingEffort: 'default',
  configurationDigest: 'configuration'
}

async function* summaryStream(text = 'Summary.'): AsyncIterable<ProviderStreamPart> {
  yield { type: 'text-delta', id: 'summary', delta: text }
  yield providerFinish({ reason: 'stop' })
}

async function* rejectedStream(): AsyncIterable<ProviderStreamPart> {
  yield providerFinish({ reason: 'length' })
}

function setup(options: { stream?: ChatProvider['stream']; maxSummaryChars?: number } = {}) {
  // The host supplies source snapshots and synchronous persistence acknowledgements.
  // Storage, digest generation and checkpoint replay are verified by the desktop suite.
  const runtime = {
    beginCompaction: vi.fn<Dependencies['runtime']['beginCompaction']>(),
    endCompaction: vi.fn<Dependencies['runtime']['endCompaction']>(),
    getCompactionSource: vi.fn<Dependencies['runtime']['getCompactionSource']>(() => ({
      throughSequence: 4,
      sourceDigest: 'source',
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Inspect the failing test' }] }]
    })),
    getDefaultProfile: vi.fn<Dependencies['runtime']['getDefaultProfile']>(() => profile),
    acceptContextCheckpoint: vi.fn<Dependencies['runtime']['acceptContextCheckpoint']>(() => {
      throw new Error('This rejected or cancelled summary must not create a checkpoint.')
    }),
    recordCompactionNotice: vi.fn<Dependencies['runtime']['recordCompactionNotice']>()
  } satisfies Dependencies['runtime']
  const stream = vi.fn<ChatProvider['stream']>(options.stream ?? (async () => rejectedStream()))
  const provider: ChatProvider = { stream, getModelCapabilities: async () => null }
  const modelProfile = {
    resolveForSession: vi.fn<Dependencies['modelProfile']['resolveForSession']>(() => ({
      provider,
      modelEntryId: profile.modelEntryId,
      configuration: { provider: 'ollama', baseUrl: 'http://localhost:11434', modelId: 'qwen3' }
    })),
    toProfile: vi.fn<Dependencies['modelProfile']['toProfile']>(
      (_configuration, _modelEntryId, thinkingEffort) => ({ ...profile, thinkingEffort })
    )
  } satisfies Dependencies['modelProfile']
  const compactor = new SessionCompactor({
    runtime,
    modelProfile,
    maxSummaryChars: options.maxSummaryChars
  })
  return { compactor, runtime, stream }
}

describe('SessionCompactor', () => {
  it('user requests a summary when no turns are completed, then the request is refused directly', async () => {
    const { compactor, runtime, stream } = setup()
    runtime.getCompactionSource.mockReturnValue(null)

    await expect(compactor.compact(sessionId)).rejects.toThrow(/no completed turns/i)

    expect(stream).not.toHaveBeenCalled()
    expect(runtime.recordCompactionNotice).not.toHaveBeenCalled()
    expect(runtime.endCompaction).toHaveBeenCalledWith(sessionId)
  })

  it('user summarizes completed history when a model rejects output, then a dedicated request yields a rejection notice', async () => {
    const { compactor, runtime, stream } = setup()

    await expect(compactor.compact(sessionId)).resolves.toMatchObject({ status: 'failed' })

    expect(stream).toHaveBeenCalledOnce()
    expect(stream.mock.calls[0][0]).toMatchObject({
      thinkingEffort: 'none',
      signal: expect.any(AbortSignal),
      messages: [
        { role: 'system', parts: [{ type: 'text', text: expect.stringContaining('checkpoint') }] },
        {
          role: 'user',
          parts: [{ type: 'text', text: expect.stringContaining('Inspect the failing test') }]
        }
      ]
    })
    expect(stream.mock.calls[0][0].tools).toBeUndefined()
    expect(runtime.recordCompactionNotice).toHaveBeenCalledWith({
      sessionId,
      coverage: { throughSequence: 4 },
      sourceDigest: 'source',
      reason: 'rejected',
      message: expect.stringContaining('summary')
    })
    expect(runtime.acceptContextCheckpoint).not.toHaveBeenCalled()
  })

  it('user receives a summary when it exceeds the length bound, then the overlong output is rejected', async () => {
    const { compactor, runtime } = setup({
      maxSummaryChars: 10,
      stream: async () => summaryStream('a'.repeat(40))
    })

    await expect(compactor.compact(sessionId)).resolves.toMatchObject({ status: 'failed' })

    expect(runtime.recordCompactionNotice).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'rejected' })
    )
    expect(runtime.acceptContextCheckpoint).not.toHaveBeenCalled()
  })

  it('user changes the session model when a summary runs, then the summary is discarded', async () => {
    const released = Promise.withResolvers<AsyncIterable<ProviderStreamPart>>()
    const { compactor, runtime } = setup({ stream: () => released.promise })

    const pending = compactor.compact(sessionId)
    runtime.getDefaultProfile.mockReturnValue({ ...profile, thinkingEffort: 'low' })
    released.resolve(summaryStream())

    await expect(pending).resolves.toMatchObject({ status: 'failed' })
    expect(runtime.recordCompactionNotice).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'profile_changed' })
    )
    expect(runtime.acceptContextCheckpoint).not.toHaveBeenCalled()
  })

  it('user cancels a summary when it is streaming, then cancellation wins over the pending output', async () => {
    const started = Promise.withResolvers<void>()
    const released = Promise.withResolvers<void>()
    const { compactor, runtime } = setup({
      stream: async () =>
        (async function* () {
          yield { type: 'text-delta' as const, id: 'summary', delta: 'Partial.' }
          started.resolve()
          await released.promise
          yield providerFinish({ reason: 'stop' })
        })()
    })

    const pending = compactor.compact(sessionId)
    await started.promise
    const cancellation = compactor.cancel(sessionId)
    released.resolve()
    await cancellation

    await expect(pending).resolves.toEqual({ status: 'cancelled' })
    expect(runtime.recordCompactionNotice).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'cancelled' })
    )
    expect(runtime.acceptContextCheckpoint).not.toHaveBeenCalled()
  })

  it('user starts two summaries when one session is selected, then the second request is refused', async () => {
    const released = Promise.withResolvers<AsyncIterable<ProviderStreamPart>>()
    const { compactor, stream } = setup({ stream: () => released.promise })

    const pending = compactor.compact(sessionId)
    await expect(compactor.compact(sessionId)).rejects.toThrow(/already running/i)
    released.resolve(rejectedStream())
    await pending

    expect(stream).toHaveBeenCalledOnce()
  })

  it('user restarts when a rejected summary finishes, then the next summary starts immediately after await', async () => {
    const { compactor, stream } = setup()

    await compactor.compact(sessionId)
    await expect(compactor.compact(sessionId)).resolves.toMatchObject({ status: 'failed' })

    expect(stream).toHaveBeenCalledTimes(2)
  })

  it('user quits when one notice failed and another is pending, then drain waits and reports both failures once', async () => {
    const released = Promise.withResolvers<AsyncIterable<ProviderStreamPart>>()
    const { compactor, runtime, stream } = setup()
    runtime.recordCompactionNotice.mockImplementation(() => {
      throw new Error('notice persistence failed')
    })
    await expect(compactor.compact(sessionId)).rejects.toThrow('notice persistence failed')
    stream.mockImplementation(() => released.promise)
    const pending = compactor.compact('second')
    compactor.dispose()
    let settled = false
    const draining = compactor
      .drain()
      .catch((error: Error) => error)
      .finally(() => {
        settled = true
      })
    await Promise.resolve()
    expect(settled).toBe(false)
    released.resolve(summaryStream())

    await expect(pending).rejects.toThrow('notice persistence failed')
    const failure = await draining
    expect(failure).toBeInstanceOf(AggregateError)
    if (!(failure instanceof AggregateError)) throw new Error('Expected persistence failures.')
    expect(failure.errors.map((error: Error) => error.message)).toEqual([
      'notice persistence failed',
      'notice persistence failed'
    ])
    await expect(compactor.drain()).resolves.toBeUndefined()
  })

  it('user retries when notice storage keeps failing, then drain reports the total with bounded samples once', async () => {
    const { compactor, runtime } = setup()
    runtime.recordCompactionNotice.mockImplementation(() => {
      throw new Error('repeated notice failure')
    })
    const attemptCount = 100

    for (let attempt = 0; attempt < attemptCount; attempt += 1) {
      await expect(compactor.compact(sessionId)).rejects.toThrow('repeated notice failure')
    }

    const failure = await compactor.drain().catch((error: Error) => error)
    expect(failure).toBeInstanceOf(AggregateError)
    if (!(failure instanceof AggregateError)) throw new Error('Expected persistence failures.')
    expect(failure.message).toContain('100')
    expect(failure.errors.length).toBeGreaterThan(0)
    expect(failure.errors.length).toBeLessThan(attemptCount)
    await expect(compactor.drain()).resolves.toBeUndefined()
  })
})
