import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'

import type { TurnStartRequest, TurnStreamEvent } from '@shared/ipc/schemas/chat'
import type { ChatProvider } from '@mico/ai-providers'
import type { UIMessageChunk } from 'ai'
import { SessionRuntimeService } from '../sessions/session-runtime-service'
import { SessionDatabase } from '../../data/session-database'
import { createChatProviderResolver } from './chat-provider-resolver'
import { TurnExecutor } from './turn-executor'

const request: TurnStartRequest = {
  sessionId: 'session-1',
  requestId: 'request-1',
  userMessage: { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
}

const textChunk: UIMessageChunk = {
  type: 'text-delta',
  id: 'part-1',
  delta: 'Hi'
}

const configuration = {
  provider: 'ollama' as const,
  baseUrl: 'http://localhost:11434',
  modelId: 'qwen3:8b'
}

async function createRuntime(): Promise<{
  database: SessionDatabase
  runtime: SessionRuntimeService
}> {
  const database = new SessionDatabase({
    getUserDataPath: () => 'unused-for-memory-database',
    openDatabase: () => new Database(':memory:')
  })
  await database.initialize()
  return { database, runtime: new SessionRuntimeService({ database }) }
}

function createDeferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function collectEvents() {
  const events: TurnStreamEvent[] = []
  const firstChunk = createDeferred()
  const terminal = createDeferred()

  return {
    emit: (event) => {
      events.push(event)
      if (event.type === 'chunk') firstChunk.resolve()
      if (event.type === 'cancelled' || event.type === 'error' || event.type === 'finish') {
        terminal.resolve()
      }
    },
    events,
    firstChunk: firstChunk.promise,
    terminal: terminal.promise
  }
}

function streamFrom(chunks: UIMessageChunk[]): AsyncIterable<UIMessageChunk> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<UIMessageChunk> {
      yield* chunks
    }
  }
}

function pendingStream(signal: AbortSignal, onStopped?: () => void): AsyncIterable<UIMessageChunk> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<UIMessageChunk> {
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true })
      )
      onStopped?.()
      yield* []
    }
  }
}

function partialPendingStream(signal: AbortSignal): AsyncIterable<UIMessageChunk> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<UIMessageChunk> {
      yield { type: 'text-delta', id: 'part-1', delta: 'Partial' }
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true })
      )
    }
  }
}

describe('TurnExecutor', () => {
  it('formats document-only messages as named text for the provider and title generation', async () => {
    const { runtime } = await createRuntime()
    const session = runtime.createSession({ title: 'New chat', defaultProfile: null })
    const calls: Parameters<ChatProvider['stream']>[0][] = []
    const titleGenerated = createDeferred()
    const recorded = collectEvents()
    const provider = createProvider(async (input) => {
      calls.push(input)
      return streamFrom([{ type: 'text-delta', id: 'part-1', delta: 'Review code' }])
    })
    const service = new TurnExecutor(() => provider, {
      runtime,
      getSelectedChatConfiguration: () => configuration
    })
    service.startTurn(
      {
        ownerId: 'window-1',
        request: {
          ...request,
          sessionId: session.id,
          userMessage: {
            role: 'user',
            parts: [{ type: 'document', name: 'index.ts', text: '  export {}\n' }]
          }
        }
      },
      recorded.emit,
      titleGenerated.resolve
    )
    await recorded.terminal

    const expected = {
      role: 'user',
      parts: [{ type: 'text', text: '<document name="index.ts">\n  export {}\n\n</document>' }]
    }
    expect(
      calls.find(({ conversationKey }) => conversationKey === `window-1:${session.id}`)?.messages
    ).toEqual([expected])
    expect(
      calls.find(({ conversationKey }) => conversationKey === `title:${session.id}`)?.messages[1]
    ).toEqual(expected)
    await titleGenerated.promise
  })

  it('formats attached documents without a persisted runtime and preserves reasoning metadata', async () => {
    const calls: Parameters<ChatProvider['stream']>[0][] = []
    const recorded = collectEvents()
    const provider = createProvider(async (input) => {
      calls.push(input)
      return streamFrom([])
    })
    const service = new TurnExecutor(() => provider)
    service.startTurn(
      {
        ownerId: 'window-1',
        request: {
          ...request,
          userMessage: {
            role: 'user',
            parts: [
              { type: 'text', text: 'Review this file.' },
              { type: 'document', name: 'a&"b.ts', text: 'export {}' },
              {
                type: 'reasoning',
                text: 'Reasoning',
                providerMetadata: { test: { signature: 'value' } }
              }
            ]
          }
        }
      },
      recorded.emit
    )
    await recorded.terminal
    expect(calls[0]?.messages).toEqual([
      {
        role: 'user',
        parts: [
          { type: 'text', text: 'Review this file.' },
          { type: 'text', text: '<document name="a&amp;&quot;b.ts">\nexport {}\n</document>' },
          {
            type: 'reasoning',
            text: 'Reasoning',
            providerMetadata: { test: { signature: 'value' } }
          }
        ]
      }
    ])
  })

  it('uses the session model entry instead of the global selected model', async () => {
    const { runtime } = await createRuntime()
    const session = runtime.createSession({
      title: 'Session',
      defaultProfile: {
        modelEntryId: 'session-model',
        providerId: 'ollama',
        modelId: 'session-model-id',
        thinkingEffort: 'default',
        configurationDigest: 'saved-configuration'
      }
    })
    const resolvedEntryIds: Array<string | undefined> = []
    const finished = createDeferred()
    const service = new TurnExecutor(
      (modelEntryId) => {
        resolvedEntryIds.push(modelEntryId)
        return modelEntryId === 'session-model' ? createProvider(async () => streamFrom([])) : null
      },
      {
        getChatConfigurationForModelEntry: (modelEntryId) =>
          modelEntryId === 'session-model' ? configuration : null,
        getSelectedModelEntryId: () => 'global-model',
        runtime
      }
    )

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      (event) => {
        if (event.type === 'finish') finished.resolve()
      }
    )

    await finished.promise
    expect(resolvedEntryIds).toEqual(['session-model'])
  })

  it('returns no capabilities and emits an error when no enabled model is selected', async () => {
    const recorded = collectEvents()
    const service = new TurnExecutor(
      createChatProviderResolver({
        createChatProvider: () => createProvider(async () => streamFrom([])),
        getChatConfigurationForModelEntry: () => null
      })
    )

    await expect(service.getModelCapabilities()).resolves.toBeNull()
    service.startTurn({ ownerId: 'window-1', request }, recorded.emit)

    await recorded.terminal
    expect(recorded.events).toEqual([
      {
        type: 'error',
        requestId: 'request-1',
        message: 'Select an enabled model in Settings before chatting.'
      }
    ])
  })

  it('emits every chunk followed by one finish for a normal run', async () => {
    const recorded = collectEvents()
    const provider = createProvider(async () => streamFrom([textChunk]))
    const service = new TurnExecutor(() => provider)

    service.startTurn({ ownerId: 'window-1', request }, recorded.emit)

    await recorded.terminal
    expect(recorded.events).toEqual([
      { type: 'chunk', requestId: 'request-1', chunk: textChunk },
      { type: 'finish', requestId: 'request-1' }
    ])
  })

  it('persists a completed visible transcript for a session', async () => {
    const { runtime } = await createRuntime()
    const session = runtime.createSession({ title: 'Session', defaultProfile: null })
    const finished = createDeferred()
    const service = new TurnExecutor(() => createProvider(async () => streamFrom([textChunk])), {
      getSelectedChatConfiguration: () => configuration,
      runtime
    })

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      (event) => {
        if (event.type === 'finish') finished.resolve()
      }
    )

    await finished.promise
    expect(runtime.loadSession(session.id).messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'Hi' }] }
    ])
  })

  it('persists a generated title after the first user message', async () => {
    const { runtime } = await createRuntime()
    const session = runtime.createSession({ title: 'New chat', defaultProfile: null })
    let titleInstructions = ''
    const provider = createProvider(async ({ messages }) => {
      if (messages[0]?.role === 'system') {
        titleInstructions = messages[0].parts[0]?.type === 'text' ? messages[0].parts[0].text : ''
        return streamFrom([{ type: 'text-delta', id: 'title-part', delta: 'Greet the user' }])
      }
      return streamFrom([textChunk])
    })
    const service = new TurnExecutor(() => provider, {
      getSelectedChatConfiguration: () => configuration,
      runtime
    })
    const titleGenerated = createDeferred()

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      () => undefined,
      () => titleGenerated.resolve()
    )

    await titleGenerated.promise
    expect(runtime.loadSession(session.id).title).toBe('Greet the user')
    expect(titleInstructions).toContain("Capture the user's actual goal")
    expect(titleInstructions).toContain('Preserve technical terms')
    expect(titleInstructions).toContain('Output exactly one title')
  })

  it('keeps the first 50 characters of a generated title', async () => {
    const { runtime } = await createRuntime()
    const session = runtime.createSession({ title: 'New chat', defaultProfile: null })
    const provider = createProvider(async ({ messages }) =>
      streamFrom(
        messages[0]?.role === 'system'
          ? [
              {
                type: 'text-delta',
                id: 'title-part',
                delta: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab'
              }
            ]
          : [textChunk]
      )
    )
    const service = new TurnExecutor(() => provider, {
      getSelectedChatConfiguration: () => configuration,
      runtime
    })
    const titleGenerated = createDeferred()

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      () => undefined,
      () => titleGenerated.resolve()
    )

    await titleGenerated.promise
    expect(runtime.loadSession(session.id).title).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
  })

  it('caps assistant response text before emitting and persisting it', async () => {
    const { runtime } = await createRuntime()
    const session = runtime.createSession({ title: 'Session', defaultProfile: null })
    const events: TurnStreamEvent[] = []
    const finished = createDeferred()
    const service = new TurnExecutor(
      () =>
        createProvider(async () =>
          streamFrom([
            { type: 'text-delta', id: 'part-1', delta: 'abcd' },
            { type: 'text-delta', id: 'part-1', delta: 'efgh' },
            { type: 'text-delta', id: 'part-1', delta: 'ignored' }
          ])
        ),
      { getSelectedChatConfiguration: () => configuration, runtime, maxAssistantTextChars: 6 }
    )

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      (event) => {
        events.push(event)
        if (event.type === 'finish') finished.resolve()
      }
    )

    await finished.promise
    expect(runtime.loadSession(session.id).messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'abcde…' }] }
    ])
    expect(events).toEqual([
      {
        type: 'chunk',
        requestId: 'request-1',
        chunk: { type: 'text-delta', id: 'part-1', delta: 'abcd' }
      },
      {
        type: 'chunk',
        requestId: 'request-1',
        chunk: { type: 'text-delta', id: 'part-1', delta: 'e…' }
      },
      { type: 'finish', requestId: 'request-1' }
    ])
  })

  it('preserves truncation behavior after a chunk exactly fills the cap', async () => {
    const { runtime } = await createRuntime()
    const session = runtime.createSession({ title: 'Session', defaultProfile: null })
    const events: TurnStreamEvent[] = []
    const finished = createDeferred()
    const service = new TurnExecutor(
      () =>
        createProvider(async () =>
          streamFrom([
            { type: 'text-delta', id: 'part-1', delta: 'abcdef' },
            { type: 'text-delta', id: 'part-1', delta: 'g' }
          ])
        ),
      { getSelectedChatConfiguration: () => configuration, runtime, maxAssistantTextChars: 6 }
    )

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      (event) => {
        events.push(event)
        if (event.type === 'finish') finished.resolve()
      }
    )

    await finished.promise
    expect(runtime.loadSession(session.id).messages.at(-1)).toEqual({
      role: 'assistant',
      parts: [{ type: 'text', text: 'abcde…' }]
    })
    expect(events).toEqual([
      {
        type: 'chunk',
        requestId: 'request-1',
        chunk: { type: 'text-delta', id: 'part-1', delta: 'abcdef' }
      },
      { type: 'finish', requestId: 'request-1' }
    ])
  })

  it('completes a persisted run when the provider returns no visible text', async () => {
    const { database, runtime } = await createRuntime()
    const session = runtime.createSession({ title: 'Session', defaultProfile: null })
    const finished = createDeferred()
    const service = new TurnExecutor(() => createProvider(async () => streamFrom([])), {
      getSelectedChatConfiguration: () => configuration,
      runtime
    })

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      (event) => {
        if (event.type === 'finish') finished.resolve()
      }
    )

    await finished.promise
    expect(database.connection.prepare('SELECT status FROM runs').all()).toEqual([
      { status: 'completed' }
    ])
    expect(runtime.loadSession(session.id).messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      { role: 'assistant', parts: [{ type: 'text', text: '' }] }
    ])
  })

  it('records a failed run without persisting assistant output', async () => {
    const { database, runtime } = await createRuntime()
    const session = runtime.createSession({ title: 'Session', defaultProfile: null })
    const failed = createDeferred()
    const service = new TurnExecutor(
      () =>
        createProvider(async () => {
          throw new Error('upstream failure')
        }),
      { getSelectedChatConfiguration: () => configuration, maxAttempts: 1, runtime }
    )

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      (event) => {
        if (event.type === 'error') failed.resolve()
      }
    )

    await failed.promise
    expect(runtime.loadSession(session.id).messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
    ])
    expect(database.connection.prepare('SELECT status FROM runs').all()).toEqual([
      { status: 'failed' }
    ])
  })

  it('regenerates a failed turn without persisting its user message twice', async () => {
    const { runtime } = await createRuntime()
    const session = runtime.createSession({ title: 'Session', defaultProfile: null })
    const failed = runtime.startTurn({
      sessionId: session.id,
      requestId: 'request-0',
      userMessage: request.userMessage,
      profile: {
        modelEntryId: 'ollama:qwen3',
        providerId: 'ollama',
        modelId: 'qwen3:8b',
        thinkingEffort: 'default',
        configurationDigest: 'saved-configuration'
      }
    })
    runtime.finishRun(failed.runId, {
      status: 'failed',
      failure: { code: 'provider_error', message: 'Failed' }
    })
    const finished = createDeferred()
    const service = new TurnExecutor(() => createProvider(async () => streamFrom([textChunk])), {
      getSelectedChatConfiguration: () => configuration,
      runtime
    })

    service.startTurn(
      {
        ownerId: 'window-1',
        request: { ...request, sessionId: session.id, retry: true }
      },
      (event) => {
        if (event.type === 'finish') finished.resolve()
      }
    )

    await finished.promise
    expect(runtime.loadSession(session.id).messages).toEqual([
      request.userMessage,
      { role: 'assistant', parts: [{ type: 'text', text: 'Hi' }] }
    ])
  })

  it('cancels a persisted run when its request is aborted', async () => {
    const { database, runtime } = await createRuntime()
    const session = runtime.createSession({ title: 'Session', defaultProfile: null })
    const providerStarted = createDeferred()
    const service = new TurnExecutor(
      () =>
        createProvider(async ({ signal }) => {
          providerStarted.resolve()
          return pendingStream(signal)
        }),
      { getSelectedChatConfiguration: () => configuration, runtime }
    )

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      () => undefined
    )
    await providerStarted.promise
    service.abortTurn({ ownerId: 'window-1', requestId: request.requestId })

    expect(runtime.loadSession(session.id).messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
    ])
    expect(database.connection.prepare('SELECT status FROM runs').all()).toEqual([
      { status: 'cancelled' }
    ])
  })

  it('persists an aborted partial response and includes it in the next turn context', async () => {
    const { runtime } = await createRuntime()
    const session = runtime.createSession({ title: 'Session', defaultProfile: null })
    const recorded = collectEvents()
    const service = new TurnExecutor(
      () => createProvider(async ({ signal }) => partialPendingStream(signal)),
      { getSelectedChatConfiguration: () => configuration, runtime }
    )

    service.startTurn(
      { ownerId: 'window-1', request: { ...request, sessionId: session.id } },
      recorded.emit
    )
    await recorded.firstChunk
    service.abortTurn({ ownerId: 'window-1', requestId: request.requestId })

    expect(runtime.loadSession(session.id).messages).toEqual([
      request.userMessage,
      {
        role: 'assistant',
        parts: [{ type: 'text', text: 'Partial' }],
        metadata: { completionState: 'stopped' }
      }
    ])

    const next = runtime.startTurn({
      sessionId: session.id,
      requestId: 'request-2',
      userMessage: { role: 'user', parts: [{ type: 'text', text: 'Continue' }] },
      profile: {
        modelEntryId: 'ollama:qwen3',
        providerId: 'ollama',
        modelId: 'qwen3:8b',
        thinkingEffort: 'default',
        configurationDigest: 'saved-configuration'
      }
    })
    expect(runtime.getContextMessages(next.runId)).toEqual([
      request.userMessage,
      {
        role: 'assistant',
        parts: [{ type: 'text', text: 'Partial' }],
        metadata: { completionState: 'stopped' }
      },
      { role: 'user', parts: [{ type: 'text', text: 'Continue' }] }
    ])
  })

  it('builds the provider request from persisted session context', async () => {
    const { runtime } = await createRuntime()
    const session = runtime.createSession({ title: 'Session', defaultProfile: null })
    const firstRun = runtime.startTurn({
      sessionId: session.id,
      requestId: 'request-0',
      userMessage: { role: 'user', parts: [{ type: 'text', text: 'Saved prompt' }] },
      profile: {
        modelEntryId: 'ollama:qwen3',
        providerId: 'ollama',
        modelId: 'qwen3:8b',
        thinkingEffort: 'default',
        configurationDigest: 'saved-configuration'
      }
    })
    runtime.finishRun(firstRun.runId, {
      status: 'completed',
      assistant: {
        role: 'assistant',
        parts: [{ type: 'text', text: 'Saved answer' }]
      }
    })
    const streamCalled = createDeferred()
    const stream = vi.fn(async () => {
      streamCalled.resolve()
      return streamFrom([])
    })
    const service = new TurnExecutor(() => createProvider(stream), {
      getSelectedChatConfiguration: () => configuration,
      runtime
    })

    service.startTurn(
      {
        ownerId: 'window-1',
        request: {
          ...request,
          sessionId: session.id,
          userMessage: { role: 'user', parts: [{ type: 'text', text: 'Current prompt' }] }
        }
      },
      () => undefined
    )

    await streamCalled.promise
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'user', parts: [{ type: 'text', text: 'Saved prompt' }] },
          { role: 'assistant', parts: [{ type: 'text', text: 'Saved answer' }] },
          { role: 'user', parts: [{ type: 'text', text: 'Current prompt' }] }
        ]
      })
    )
  })

  it('reports runtime setup errors without calling the provider', async () => {
    const { runtime } = await createRuntime()
    const stream = vi.fn(async () => streamFrom([]))
    const service = new TurnExecutor(() => createProvider(stream), {
      getSelectedChatConfiguration: () => configuration,
      runtime
    })
    const recorded = collectEvents()

    service.startTurn({ ownerId: 'window-1', request }, recorded.emit)

    await recorded.terminal
    expect(recorded.events[0]).toMatchObject({ type: 'error', requestId: request.requestId })
    expect(stream).not.toHaveBeenCalled()
  })

  it('aborts only the matching owner and request with one explicit terminal event', async () => {
    const events: TurnStreamEvent[] = []
    const signals = new Map<string, AbortSignal>()
    const streamsStarted = createDeferred()
    const firstStreamStopped = createDeferred()
    const provider = createProvider(async ({ signal }) => {
      signals.set(String(signals.size + 1), signal)
      if (signals.size === 2) streamsStarted.resolve()
      return pendingStream(signal, signals.size === 1 ? firstStreamStopped.resolve : undefined)
    })
    const service = new TurnExecutor(() => provider)

    service.startTurn({ ownerId: 'window-1', request }, (event) => events.push(event))
    service.startTurn(
      { ownerId: 'window-2', request: { ...request, requestId: 'request-2' } },
      (event) => events.push(event)
    )
    await streamsStarted.promise

    service.abortTurn({ ownerId: 'window-1', requestId: 'request-1' })
    service.abortTurn({ ownerId: 'window-1', requestId: 'request-1' })

    expect(signals.get('1')?.aborted).toBe(true)
    expect(signals.get('2')?.aborted).toBe(false)
    await firstStreamStopped.promise
    expect(events).toEqual([{ type: 'cancelled', requestId: 'request-1' }])
  })

  it('keeps requests with the same ID isolated by owner during abortAll', async () => {
    const signals: AbortSignal[] = []
    const streamsStarted = createDeferred()
    const provider = createProvider(async ({ signal }) => {
      signals.push(signal)
      if (signals.length === 2) streamsStarted.resolve()
      return pendingStream(signal)
    })
    const service = new TurnExecutor(() => provider)

    service.startTurn({ ownerId: 'window-1', request }, () => undefined)
    service.startTurn({ ownerId: 'window-2', request }, () => undefined)
    await streamsStarted.promise

    service.abortAllTurns('window-1')

    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
  })

  it('aborts every active run when disposed', async () => {
    const signals: AbortSignal[] = []
    const streamsStarted = createDeferred()
    const provider = createProvider(async ({ signal }) => {
      signals.push(signal)
      if (signals.length === 2) streamsStarted.resolve()
      return pendingStream(signal)
    })
    const service = new TurnExecutor(() => provider)

    service.startTurn({ ownerId: 'window-1', request }, () => undefined)
    service.startTurn(
      { ownerId: 'window-2', request: { ...request, requestId: 'request-2' } },
      () => undefined
    )
    await streamsStarted.promise

    service.dispose()

    expect(signals.map((signal) => signal.aborted)).toEqual([true, true])
  })

  it('emits a safe generic error without finishing when the stream fails', async () => {
    const recorded = collectEvents()
    const stream = vi.fn(async () => {
      throw new Error('upstream credential details')
    })
    const service = new TurnExecutor(() => createProvider(stream))

    service.startTurn({ ownerId: 'window-1', request }, recorded.emit)

    await recorded.terminal
    expect(recorded.events).toEqual([
      {
        type: 'error',
        requestId: 'request-1',
        message: "Couldn't generate a response. Please try again."
      }
    ])
  })

  it('retries a connection failure before any response content is sent', async () => {
    const recorded = collectEvents()
    let calls = 0
    const stream = async () => {
      calls += 1
      if (calls === 1) throw new TypeError('fetch failed')
      return streamFrom([textChunk])
    }
    const service = new TurnExecutor(() => createProvider(stream), {
      maxAttempts: 2,
      retryDelayMs: 0
    })

    service.startTurn({ ownerId: 'window-1', request }, recorded.emit)

    await recorded.terminal
    expect(recorded.events).toEqual([
      {
        type: 'retry',
        requestId: 'request-1',
        attempt: 2,
        maxAttempts: 2,
        retryDelayMs: 0
      },
      { type: 'chunk', requestId: 'request-1', chunk: textChunk },
      { type: 'finish', requestId: 'request-1' }
    ])
  })

  it('keeps partial content and reports a connection failure without retrying', async () => {
    const recorded = collectEvents()
    const provider = createProvider(async () => ({
      async *[Symbol.asyncIterator](): AsyncIterator<UIMessageChunk> {
        yield textChunk
        throw new TypeError('fetch failed')
      }
    }))
    const service = new TurnExecutor(() => provider, { maxAttempts: 2, retryDelayMs: 0 })

    service.startTurn({ ownerId: 'window-1', request }, recorded.emit)

    await recorded.terminal
    expect(recorded.events).toEqual([
      { type: 'chunk', requestId: 'request-1', chunk: textChunk },
      {
        type: 'error',
        requestId: 'request-1',
        message: "Couldn't connect to the API endpoint. Check the API URL, network, VPN, or proxy."
      }
    ])
  })

  it('passes a sender-scoped conversation key and the request effort to the provider', async () => {
    const streamCalled = createDeferred()
    const stream = vi.fn(async () => {
      streamCalled.resolve()
      return streamFrom([])
    })
    const service = new TurnExecutor(() => createProvider(stream))

    service.startTurn(
      {
        ownerId: '42',
        request: { ...request, sessionId: 'session-1', thinkingEffort: 'high' }
      },
      () => undefined
    )

    await streamCalled.promise
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({ conversationKey: '42:session-1', thinkingEffort: 'high' })
    )
  })
})

function createProvider(
  stream: ChatProvider['stream']
): Pick<ChatProvider, 'getModelCapabilities' | 'stream'> {
  return { getModelCapabilities: vi.fn(async () => null), stream }
}
