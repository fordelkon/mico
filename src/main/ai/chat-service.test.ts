import { describe, expect, it, vi } from 'vitest'

import type { ChatStartRequest, ChatStreamEvent } from '@shared/data/schemas/chat'
import type { ChatProvider } from '@mico/ai-providers'
import type { UIMessageChunk } from 'ai'
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
  it('emits every chunk followed by one finish for a normal run', async () => {
    const events: ChatStreamEvent[] = []
    const provider = createProvider(async () => streamFrom([textChunk]))
    const service = new ChatService(provider)

    service.start({ ownerId: 'window-1', request }, (event) => events.push(event))

    await waitFor(() => {
      expect(events).toEqual([
        { type: 'chunk', requestId: 'request-1', chunk: textChunk },
        { type: 'finish', requestId: 'request-1' }
      ])
    })
  })

  it('aborts only the matching owner and request without a finish event', async () => {
    const events: ChatStreamEvent[] = []
    const signals = new Map<string, AbortSignal>()
    const provider = createProvider(async ({ signal }) => {
      signals.set(String(signals.size + 1), signal)
      return pendingStream(signal)
    })
    const service = new ChatService(provider)

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
    const service = new ChatService(provider)

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
    const service = new ChatService(provider)

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
    const service = new ChatService(createProvider(stream))

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
    const service = new ChatService(createProvider(stream), {
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
    const service = new ChatService(provider, { maxAttempts: 2, retryDelayMs: 0 })

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
    const service = new ChatService(createProvider(stream))

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
