import type { ChatProvider, ProviderStreamPart } from '@mico/ai-providers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionProfileSnapshot, TurnStartRequest, TurnStreamEvent } from '../contracts'
import { SessionModelProfile, type SessionModels } from './model-profile'
import type { SessionStore, TurnRunHandle } from './session-store'
import { TurnExecutor, type TurnExecutorOptions } from './turn'

const request: TurnStartRequest = {
  sessionId: 'session-1',
  requestId: 'request-1',
  userMessage: { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
}
const textChunk = { type: 'text-delta' as const, id: 'part-1', delta: 'Hi' }
const profile: ExecutionProfileSnapshot = {
  modelEntryId: 'model',
  providerId: 'ollama',
  modelId: 'qwen3',
  thinkingEffort: 'default',
  configurationDigest: 'configuration'
}
const executors: TurnExecutor[] = []
afterEach(async () => {
  for (const executor of executors.splice(0)) {
    executor.dispose()
    await executor.drain()
  }
})

async function* streamFrom(parts: ProviderStreamPart[]): AsyncIterable<ProviderStreamPart> {
  yield* parts
}

function collectEvents() {
  const events: TurnStreamEvent[] = []
  const terminal = Promise.withResolvers<void>()
  return {
    events,
    terminal: terminal.promise,
    emit: (event: TurnStreamEvent): void => {
      events.push(event)
      if (event.type === 'cancelled' || event.type === 'error' || event.type === 'finish')
        terminal.resolve()
    }
  }
}

function createExecutor(
  provider: ChatProvider,
  options: Pick<TurnExecutorOptions, 'maxAttempts' | 'retryDelayMs'> = {}
) {
  // Host callbacks acknowledge execution facts; no transcript or SQL semantics are
  // simulated here. Desktop integration tests own persistence and recovery.
  const runtime = {
    previewTurn: vi.fn<SessionStore['previewTurn']>((_sessionId, _requestId, userMessage) => ({
      existing: false,
      profile: undefined,
      cwd: null,
      projectId: null,
      contextMessages: undefined,
      replayMessages: [
        {
          role: 'user',
          parts: [
            {
              type: 'text',
              text: userMessage.parts[0].type === 'text' ? userMessage.parts[0].text : ''
            }
          ]
        }
      ]
    })),
    beginTurn: vi.fn<SessionStore['beginTurn']>((input) => ({
      cwd: null,
      projectId: null,
      contextMessages: undefined,
      replayMessages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
      profile: input.profile,
      shouldGenerateTitle: false,
      recordContext: vi.fn<TurnRunHandle['recordContext']>(),
      recordStep: vi.fn<TurnRunHandle['recordStep']>(),
      recordModelStep: vi.fn<TurnRunHandle['recordModelStep']>(),
      recordToolExecutionStarted: vi.fn<TurnRunHandle['recordToolExecutionStarted']>(),
      recordToolExecutionSettled: vi.fn<TurnRunHandle['recordToolExecutionSettled']>(),
      complete: vi.fn<TurnRunHandle['complete']>(),
      fail: vi.fn<TurnRunHandle['fail']>(),
      cancel: vi.fn<TurnRunHandle['cancel']>()
    })),
    renameSessionIfCurrentTitle: vi.fn<SessionStore['renameSessionIfCurrentTitle']>(),
    getRetryProfile: vi.fn<SessionStore['getRetryProfile']>(() => profile),
    getCompactionSource: vi.fn<SessionStore['getCompactionSource']>(),
    getLatestCheckpointCoverage: vi.fn<SessionStore['getLatestCheckpointCoverage']>(),
    getDefaultProfile: vi.fn<SessionStore['getDefaultProfile']>(() => null),
    updateDefaultProfile: vi.fn<SessionStore['updateDefaultProfile']>(),
    updateDefaultProfileIfCurrent: vi.fn<SessionStore['updateDefaultProfileIfCurrent']>()
  }
  const configuration = {
    provider: 'ollama' as const,
    baseUrl: 'http://localhost:11434',
    modelId: 'qwen3'
  }
  const models = {
    resolveForSession: () => ({ provider, configuration, modelEntryId: profile.modelEntryId }),
    resolveForProfile: () => ({ provider, configuration, modelEntryId: profile.modelEntryId }),
    getCapabilities: provider.getModelCapabilities,
    getChatConfigurationForModelEntry: () => configuration,
    toProfile: (_configuration, _modelEntryId, thinkingEffort) => ({ ...profile, thinkingEffort })
  } satisfies SessionModels
  const executor = new TurnExecutor({
    profiles: new SessionModelProfile({ models, runtime }),
    runtime,
    requestApproval: async () => false,
    ...options
  })
  executors.push(executor)
  return executor
}

function createProvider(stream: ChatProvider['stream']): ChatProvider {
  return { stream, getModelCapabilities: async () => null }
}

async function startPendingTurns() {
  const started = Promise.withResolvers<void>()
  const signals: AbortSignal[] = []
  const events: TurnStreamEvent[] = []
  const service = createExecutor(
    createProvider(async ({ signal }) => {
      signals.push(signal)
      if (signals.length === 2) started.resolve()
      return {
        async *[Symbol.asyncIterator](): AsyncIterator<ProviderStreamPart> {
          if (!signal.aborted)
            await new Promise<void>((resolve) =>
              signal.addEventListener('abort', () => resolve(), { once: true })
            )
          yield* []
        }
      }
    })
  )
  service.startTurn({ ownerId: 'window-1', request }, (event) => events.push(event))
  service.startTurn(
    { ownerId: 'window-2', request: { ...request, sessionId: 'session-2' } },
    (event) => events.push(event)
  )
  await started.promise
  return { service, signals, events }
}

describe('TurnExecutor event delivery', () => {
  it('user aborts only the matching run when targeting it, then one terminal event is emitted', async () => {
    const { service, signals, events } = await startPendingTurns()

    await Promise.all([
      service.abortTurn({ ownerId: 'window-1', requestId: 'request-1' }),
      service.abortTurn({ ownerId: 'window-1', requestId: 'request-1' })
    ])

    expect(signals.map((signal) => signal.aborted)).toEqual([true, false])
    expect(events.filter((event) => event.type !== 'context-measurement')).toEqual([
      { type: 'cancelled', requestId: 'request-1' }
    ])
  })

  it('user keeps same-ID requests isolated when aborting one owner, then only that owner is aborted', async () => {
    const { service, signals } = await startPendingTurns()

    service.abortAllTurns('window-1')

    expect(signals.map((signal) => signal.aborted)).toEqual([true, false])
  })

  it('user sees every active run aborted when the executor is disposed, then all signals abort', async () => {
    const { service, signals } = await startPendingTurns()

    service.dispose()

    expect(signals.map((signal) => signal.aborted)).toEqual([true, true])
  })

  it('user sees every chunk when the provider streams normally, then one finish event follows', async () => {
    const recorded = collectEvents()
    const service = createExecutor(createProvider(async () => streamFrom([textChunk])))

    service.startTurn({ ownerId: 'window-1', request }, recorded.emit)
    await recorded.terminal

    expect(recorded.events[0]).toEqual({
      type: 'context-measurement',
      requestId: 'request-1',
      measurement: { policyId: 'unicode-heuristic-v1', estimatedInputTokens: 3 }
    })
    expect(recorded.events.filter((event) => event.type !== 'context-measurement')).toEqual([
      { type: 'chunk', requestId: 'request-1', chunk: textChunk },
      {
        type: 'chunk',
        requestId: 'request-1',
        chunk: { type: 'message-metadata', messageMetadata: { completionState: 'complete' } }
      },
      { type: 'finish', requestId: 'request-1' }
    ])
  })

  it('user sees a safe generic error when the stream fails, then upstream details are hidden', async () => {
    const recorded = collectEvents()
    const service = createExecutor(
      createProvider(async () => {
        throw new Error('upstream credential details')
      })
    )

    service.startTurn({ ownerId: 'window-1', request }, recorded.emit)
    await recorded.terminal

    expect(recorded.events.filter((event) => event.type !== 'context-measurement')).toEqual([
      {
        type: 'error',
        requestId: 'request-1',
        message: "Couldn't generate a response. Please try again."
      }
    ])
  })

  it('user sees a retry when the connection fails before any content, then the run finishes normally', async () => {
    const recorded = collectEvents()
    const stream = vi
      .fn<ChatProvider['stream']>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(streamFrom([textChunk]))
    const service = createExecutor(createProvider(stream), { maxAttempts: 2, retryDelayMs: 0 })

    service.startTurn({ ownerId: 'window-1', request }, recorded.emit)
    await recorded.terminal

    expect(recorded.events.filter((event) => event.type !== 'context-measurement')).toEqual([
      { type: 'retry', requestId: 'request-1', attempt: 2, maxAttempts: 2, retryDelayMs: 0 },
      { type: 'chunk', requestId: 'request-1', chunk: textChunk },
      {
        type: 'chunk',
        requestId: 'request-1',
        chunk: { type: 'message-metadata', messageMetadata: { completionState: 'complete' } }
      },
      { type: 'finish', requestId: 'request-1' }
    ])
  })

  it('user keeps partial content when the connection fails mid-stream, then an error follows without retry', async () => {
    const recorded = collectEvents()
    const service = createExecutor(
      createProvider(async () => ({
        async *[Symbol.asyncIterator]() {
          yield textChunk
          throw new TypeError('fetch failed')
        }
      })),
      { maxAttempts: 2, retryDelayMs: 0 }
    )

    service.startTurn({ ownerId: 'window-1', request }, recorded.emit)
    await recorded.terminal

    expect(recorded.events.filter((event) => event.type !== 'context-measurement')).toEqual([
      { type: 'chunk', requestId: 'request-1', chunk: textChunk },
      {
        type: 'error',
        requestId: 'request-1',
        message: "Couldn't connect to the API endpoint. Check the API URL, network, VPN, or proxy."
      }
    ])
  })

  it('user gets the requested thinking effort when starting a turn, then it reaches the provider', async () => {
    const recorded = collectEvents()
    const stream = vi.fn<ChatProvider['stream']>(async () => streamFrom([]))
    const service = createExecutor({
      stream,
      getModelCapabilities: async () => ({
        selectableEfforts: ['default', 'high'],
        defaultEffort: 'default'
      })
    })

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, thinkingEffort: 'high' } },
      recorded.emit
    )
    await recorded.terminal

    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ thinkingEffort: 'high' }))
  })
})
