import { describe, expect, it, vi } from 'vitest'

import type { ChatMessage, ChatStartRequest, ChatStreamEvent } from '@shared/data/schemas/chat'
import type { UIMessageChunk } from 'ai'
import { ChatService, type ChatStreamFactory } from './chat-service'

const request: ChatStartRequest = {
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
    const factory: ChatStreamFactory = async () => streamFrom([textChunk])
    const service = new ChatService(factory)

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
    const factory: ChatStreamFactory = async (_messages: ChatMessage[], signal) => {
      signals.set(String(signals.size + 1), signal)
      return pendingStream(signal)
    }
    const service = new ChatService(factory)

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
    const factory: ChatStreamFactory = async (_messages, signal) => {
      signals.push(signal)
      return pendingStream(signal)
    }
    const service = new ChatService(factory)

    service.start({ ownerId: 'window-1', request }, () => undefined)
    service.start({ ownerId: 'window-2', request }, () => undefined)
    await waitFor(() => expect(signals).toHaveLength(2))

    service.abortAll('window-1')

    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
  })

  it('aborts every active run when disposed', async () => {
    const signals: AbortSignal[] = []
    const factory: ChatStreamFactory = async (_messages, signal) => {
      signals.push(signal)
      return pendingStream(signal)
    }
    const service = new ChatService(factory)

    service.start({ ownerId: 'window-1', request }, () => undefined)
    service.start(
      { ownerId: 'window-2', request: { ...request, requestId: 'request-2' } },
      () => undefined
    )
    await waitFor(() => expect(signals).toHaveLength(2))

    service.dispose()

    expect(signals.map((signal) => signal.aborted)).toEqual([true, true])
  })

  it('emits a generic provider error without finishing when the stream fails', async () => {
    const events: ChatStreamEvent[] = []
    const factory = vi.fn<ChatStreamFactory>(async () => {
      throw new Error('upstream credential details')
    })
    const service = new ChatService(factory)

    service.start({ ownerId: 'window-1', request }, (event) => events.push(event))

    await waitFor(() => {
      expect(events).toEqual([
        {
          type: 'error',
          requestId: 'request-1',
          message: 'Unable to get a response from the chat provider'
        }
      ])
    })
  })
})
