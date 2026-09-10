import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'

import type { ChatStartRequest, ChatStreamEvent } from '@shared/data/schemas/chat'
import type { ChatProvider } from '@mico/ai-providers'
import type { UIMessageChunk } from 'ai'
import { SessionRuntimeService } from '../sessions/session-runtime-service'
import { SessionDatabase } from '../../data/session-database'
import { createChatProviderResolver } from './chat-provider-resolver'
import { ChatService } from './chat-service'

const request: ChatStartRequest = {
  conversationId: 'chat-1',
  requestId: 'request-1',
  messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }]
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

async function waitFor(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion()
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  assertion()
}

function streamFrom(chunks: UIMessageChunk[]): AsyncIterable<UIMessageChunk> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<UIMessageChunk> {
      yield* chunks
    }
  }
}

function pendingStream(signal: AbortSignal): AsyncIterable<UIMessageChunk> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<UIMessageChunk> {
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true })
      )
      yield* []
    }
  }
}

describe('ChatService', () => {
  it('returns no capabilities and emits an error when no enabled model is selected', async () => {
    const events: ChatStreamEvent[] = []
    const service = new ChatService(
      createChatProviderResolver({
        createChatProvider: () => createProvider(async () => streamFrom([])),
        getSelectedChatConfiguration: () => null
      })
    )

    await expect(service.getModelCapabilities()).resolves.toBeNull()
    service.start({ ownerId: 'window-1', request }, (event) => events.push(event))

    await waitFor(() => {
      expect(events).toEqual([
        {
          type: 'error',
          requestId: 'request-1',
          message: 'Select an enabled model in Settings before chatting.'
        }
      ])
    })
  })

  it('emits every chunk followed by one finish for a normal run', async () => {
    const events: ChatStreamEvent[] = []
    const provider = createProvider(async () => streamFrom([textChunk]))
    const service = new ChatService(() => provider)

    service.start({ ownerId: 'window-1', request }, (event) => events.push(event))

    await waitFor(() => {
      expect(events).toEqual([
        { type: 'chunk', requestId: 'request-1', chunk: textChunk },
        { type: 'finish', requestId: 'request-1' }
      ])
    })
  })

  it('persists a completed visible transcript for a session', async () => {
    const { runtime } = await createRuntime()
    const session = runtime.createSession({ title: 'Session', defaultProfile: null })
    let resolveFinish: () => void
    const finished = new Promise<void>((resolve) => {
      resolveFinish = resolve
    })
    const service = new ChatService(() => createProvider(async () => streamFrom([textChunk])), {
      getSelectedChatConfiguration: () => configuration,
      runtime
    })

    service.start(
      { ownerId: 'window-1', request: { ...request, conversationId: session.id } },
      (event) => {
        if (event.type === 'finish') resolveFinish()
      }
    )

    await finished
    expect(runtime.loadSession(session.id).messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'Hi' }] }
    ])
  })

  it('completes a persisted run when the provider returns no visible text', async () => {
    const { database, runtime } = await createRuntime()
    const session = runtime.createSession({ title: 'Session', defaultProfile: null })
    let resolveFinish: () => void
    const finished = new Promise<void>((resolve) => {
      resolveFinish = resolve
    })
    const service = new ChatService(() => createProvider(async () => streamFrom([])), {
      getSelectedChatConfiguration: () => configuration,
      runtime
    })

    service.start(
      { ownerId: 'window-1', request: { ...request, conversationId: session.id } },
      (event) => {
        if (event.type === 'finish') resolveFinish()
      }
    )

    await finished
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
    let resolveError: () => void
    const failed = new Promise<void>((resolve) => {
      resolveError = resolve
    })
    const service = new ChatService(
      () =>
        createProvider(async () => {
          throw new Error('upstream failure')
        }),
      { getSelectedChatConfiguration: () => configuration, maxAttempts: 1, runtime }
    )

    service.start(
      { ownerId: 'window-1', request: { ...request, conversationId: session.id } },
      (event) => {
        if (event.type === 'error') resolveError()
      }
    )

    await failed
    expect(runtime.loadSession(session.id).messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
    ])
    expect(database.connection.prepare('SELECT status FROM runs').all()).toEqual([
      { status: 'failed' }
    ])
  })

  it('cancels a persisted run when its request is aborted', async () => {
    const { database, runtime } = await createRuntime()
    const session = runtime.createSession({ title: 'Session', defaultProfile: null })
    let resolveProviderStart: () => void
    const providerStarted = new Promise<void>((resolve) => {
      resolveProviderStart = resolve
    })
    const service = new ChatService(
      () =>
        createProvider(async ({ signal }) => {
          resolveProviderStart()
          return pendingStream(signal)
        }),
      { getSelectedChatConfiguration: () => configuration, runtime }
    )

    service.start(
      { ownerId: 'window-1', request: { ...request, conversationId: session.id } },
      () => undefined
    )
    await providerStarted
    service.abort({ ownerId: 'window-1', requestId: request.requestId })

    expect(runtime.loadSession(session.id).messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
    ])
    expect(database.connection.prepare('SELECT status FROM runs').all()).toEqual([
      { status: 'cancelled' }
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
        providerId: 'ollama',
        modelId: 'qwen3:8b',
        thinkingEffort: 'default',
        configurationDigest: 'saved-configuration'
      }
    })
    runtime.finalizeRun(firstRun.runId, {
      role: 'assistant',
      parts: [{ type: 'text', text: 'Saved answer' }]
    })
    const stream = vi.fn(async () => streamFrom([]))
    const service = new ChatService(() => createProvider(stream), {
      getSelectedChatConfiguration: () => configuration,
      runtime
    })

    service.start(
      {
        ownerId: 'window-1',
        request: {
          ...request,
          conversationId: session.id,
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'Current prompt' }] }]
        }
      },
      () => undefined
    )

    await waitFor(() =>
      expect(stream).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'user', parts: [{ type: 'text', text: 'Saved prompt' }] },
            { role: 'assistant', parts: [{ type: 'text', text: 'Saved answer' }] },
            { role: 'user', parts: [{ type: 'text', text: 'Current prompt' }] }
          ]
        })
      )
    )
  })

  it('reports runtime setup errors without calling the provider', async () => {
    const { runtime } = await createRuntime()
    const stream = vi.fn(async () => streamFrom([]))
    const service = new ChatService(() => createProvider(stream), {
      getSelectedChatConfiguration: () => configuration,
      runtime
    })
    const events: ChatStreamEvent[] = []

    service.start({ ownerId: 'window-1', request }, (event) => events.push(event))

    await waitFor(() => expect(events).toHaveLength(1))
    expect(events[0]).toMatchObject({ type: 'error', requestId: request.requestId })
    expect(stream).not.toHaveBeenCalled()
  })

  it('aborts only the matching owner and request without a finish event', async () => {
    const events: ChatStreamEvent[] = []
    const signals = new Map<string, AbortSignal>()
    const provider = createProvider(async ({ signal }) => {
      signals.set(String(signals.size + 1), signal)
      return pendingStream(signal)
    })
    const service = new ChatService(() => provider)

    service.start({ ownerId: 'window-1', request }, (event) => events.push(event))
    service.start(
      { ownerId: 'window-2', request: { ...request, requestId: 'request-2' } },
      (event) => events.push(event)
    )
    await waitFor(() => expect(signals.size).toBe(2))

    service.abort({ ownerId: 'window-1', requestId: 'request-1' })

    expect(signals.get('1')?.aborted).toBe(true)
    expect(signals.get('2')?.aborted).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).toEqual([])
  })

  it('keeps requests with the same ID isolated by owner during abortAll', async () => {
    const signals: AbortSignal[] = []
    const provider = createProvider(async ({ signal }) => {
      signals.push(signal)
      return pendingStream(signal)
    })
    const service = new ChatService(() => provider)

    service.start({ ownerId: 'window-1', request }, () => undefined)
    service.start({ ownerId: 'window-2', request }, () => undefined)
    await waitFor(() => expect(signals).toHaveLength(2))

    service.abortAll('window-1')

    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
  })

  it('aborts every active run when disposed', async () => {
    const signals: AbortSignal[] = []
    const provider = createProvider(async ({ signal }) => {
      signals.push(signal)
      return pendingStream(signal)
    })
    const service = new ChatService(() => provider)

    service.start({ ownerId: 'window-1', request }, () => undefined)
    service.start(
      { ownerId: 'window-2', request: { ...request, requestId: 'request-2' } },
      () => undefined
    )
    await waitFor(() => expect(signals).toHaveLength(2))

    service.dispose()

    expect(signals.map((signal) => signal.aborted)).toEqual([true, true])
  })

  it('emits a safe generic error without finishing when the stream fails', async () => {
    const events: ChatStreamEvent[] = []
    const stream = vi.fn(async () => {
      throw new Error('upstream credential details')
    })
    const service = new ChatService(() => createProvider(stream))

    service.start({ ownerId: 'window-1', request }, (event) => events.push(event))

    await waitFor(() => {
      expect(events).toEqual([
        {
          type: 'error',
          requestId: 'request-1',
          message: "Couldn't generate a response. Please try again."
        }
      ])
    })
  })

  it('retries a connection failure before any response content is sent', async () => {
    const events: ChatStreamEvent[] = []
    let calls = 0
    const stream = async () => {
      calls += 1
      if (calls === 1) throw new TypeError('fetch failed')
      return streamFrom([textChunk])
    }
    const service = new ChatService(() => createProvider(stream), {
      maxAttempts: 2,
      retryDelayMs: 0
    })

    service.start({ ownerId: 'window-1', request }, (event) => events.push(event))

    await waitFor(() => {
      expect(events).toEqual([
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
  })

  it('keeps partial content and reports a connection failure without retrying', async () => {
    const events: ChatStreamEvent[] = []
    const provider = createProvider(async () => ({
      async *[Symbol.asyncIterator](): AsyncIterator<UIMessageChunk> {
        yield textChunk
        throw new TypeError('fetch failed')
      }
    }))
    const service = new ChatService(() => provider, { maxAttempts: 2, retryDelayMs: 0 })

    service.start({ ownerId: 'window-1', request }, (event) => events.push(event))

    await waitFor(() => {
      expect(events).toEqual([
        { type: 'chunk', requestId: 'request-1', chunk: textChunk },
        {
          type: 'error',
          requestId: 'request-1',
          message:
            "Couldn't connect to the API endpoint. Check the API URL, network, VPN, or proxy."
        }
      ])
    })
  })

  it('passes a sender-scoped conversation key and the request effort to the provider', async () => {
    const stream = vi.fn(async () => streamFrom([]))
    const service = new ChatService(() => createProvider(stream))

    service.start(
      {
        ownerId: '42',
        request: { ...request, conversationId: 'chat-1', thinkingEffort: 'high' }
      },
      () => undefined
    )

    await waitFor(() =>
      expect(stream).toHaveBeenCalledWith(
        expect.objectContaining({ conversationKey: '42:chat-1', thinkingEffort: 'high' })
      )
    )
  })
})

function createProvider(
  stream: ChatProvider['stream']
): Pick<ChatProvider, 'getModelCapabilities' | 'stream'> {
  return { getModelCapabilities: vi.fn(async () => null), stream }
}
