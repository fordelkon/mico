import type { ChatTransport } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ThinkingSelection } from '@shared/data/schemas/chat'
import type { ChatAPI, TurnStreamEvent } from '@shared/ipc/schemas/chat'
import type { MicoUIMessage } from '@renderer/types/chat'
import { ElectronChatTransport } from './electron-chat-transport'

class FakeChatAPI implements ChatAPI {
  readonly abortedRequestIds: string[] = []
  readonly startedRequests: Parameters<ChatAPI['startTurn']>[0][] = []
  readonly listeners = new Set<Parameters<ChatAPI['onTurnEvent']>[0]>()
  unsubscribeCount = 0

  async abortTurn(requestId: string): Promise<void> {
    this.abortedRequestIds.push(requestId)
  }

  async getCapabilities(): Promise<null> {
    return null
  }

  onTurnEvent(listener: Parameters<ChatAPI['onTurnEvent']>[0]): () => void {
    this.listeners.add(listener)
    return () => {
      this.unsubscribeCount += 1
      this.listeners.delete(listener)
    }
  }

  async startTurn(request: Parameters<ChatAPI['startTurn']>[0]): Promise<void> {
    this.startedRequests.push(request)
  }

  emit(event: TurnStreamEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

function createTransport(getThinkingEffort: () => ThinkingSelection = () => 'default') {
  const api = new FakeChatAPI()
  const transport = new ElectronChatTransport(api, {
    sessionId: 'conversation-1',
    getThinkingEffort
  })
  return { api, transport }
}

const requestId = '00000000-0000-4000-8000-000000000001'
const sendOptions: Parameters<ChatTransport<MicoUIMessage>['sendMessages']>[0] = {
  abortSignal: undefined,
  chatId: 'conversation-1',
  messageId: undefined,
  messages: [
    {
      id: 'user-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello' }]
    }
  ],
  trigger: 'submit-message'
}

beforeEach(() => {
  // SAFETY: request ids must be deterministic for the tests to assert the exact IPC payloads.
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(requestId)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('ElectronChatTransport', () => {
  it.each(['submit-message', 'regenerate-message'] as const)(
    'user keeps attached documents when sending %s, then the request carries them',
    async (trigger) => {
      const { api, transport } = createTransport()
      const stream = await transport.sendMessages({
        ...sendOptions,
        trigger,
        messages: [
          {
            id: 'user-1',
            role: 'user',
            parts: [
              { type: 'text', text: 'Review this file.' },
              {
                type: 'data-document',
                data: { type: 'document', name: 'index.ts', text: 'export {}' }
              }
            ]
          }
        ]
      })

      expect(api.startedRequests[0]?.userMessage.parts).toEqual([
        { type: 'text', text: 'Review this file.' },
        { type: 'document', name: 'index.ts', text: 'export {}' }
      ])
      expect(api.startedRequests[0]?.retry).toBe(
        trigger === 'regenerate-message' ? true : undefined
      )
      await stream.cancel()
    }
  )

  it('user sends a document-only message when there is no text, then only it is sent', async () => {
    const { api, transport } = createTransport()
    const stream = await transport.sendMessages({
      ...sendOptions,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'data-document', data: { type: 'document', name: 'empty.ts', text: '' } }]
        }
      ]
    })
    expect(api.startedRequests[0]?.userMessage.parts).toEqual([
      { type: 'document', name: 'empty.ts', text: '' }
    ])
    await stream.cancel()
  })

  it('user sees the effort captured when sending, then later changes do not apply', async () => {
    let effort: ThinkingSelection = 'low'
    const { api, transport } = createTransport(() => effort)

    const stream = await transport.sendMessages(sendOptions)
    effort = 'high'

    expect(api.startedRequests[0]).toMatchObject({
      sessionId: 'conversation-1',
      thinkingEffort: 'low'
    })

    await stream.cancel()
  })

  it('user sends only the latest message when submitting, then prior ones stay out', async () => {
    const { api, transport } = createTransport()

    const stream = await transport.sendMessages({
      ...sendOptions,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Previous prompt' }]
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Previous answer' }]
        },
        {
          id: 'user-2',
          role: 'user',
          parts: [{ type: 'text', text: 'Current prompt' }]
        }
      ]
    })

    expect(api.startedRequests[0]).toEqual({
      sessionId: 'conversation-1',
      requestId,
      thinkingEffort: 'default',
      userMessage: {
        role: 'user',
        parts: [{ type: 'text', text: 'Current prompt' }]
      }
    })

    await stream.cancel()
  })

  it('user receives chunks when the request streams, then the stream closes on finish', async () => {
    const { api, transport } = createTransport()
    const stream = await transport.sendMessages(sendOptions)
    const reader = stream.getReader()

    api.emit({
      type: 'chunk',
      requestId,
      chunk: { type: 'text-delta', id: 'part-1', delta: 'Hi' }
    })
    api.emit({ type: 'finish', requestId })

    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { type: 'text-delta', id: 'part-1', delta: 'Hi' }
    })
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
    expect(api.startedRequests).toEqual([
      {
        sessionId: 'conversation-1',
        requestId,
        userMessage: { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
        thinkingEffort: 'default'
      }
    ])
    expect(api.unsubscribeCount).toBe(1)
  })

  it('user sees the stream close when cancelled, then the buffered chunk still arrives', async () => {
    const { api, transport } = createTransport()
    const stream = await transport.sendMessages(sendOptions)
    const reader = stream.getReader()

    api.emit({
      type: 'chunk',
      requestId,
      chunk: { type: 'text-delta', id: 'part-1', delta: 'Partial' }
    })
    api.emit({ type: 'cancelled', requestId })

    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { type: 'text-delta', id: 'part-1', delta: 'Partial' }
    })
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
    expect(api.unsubscribeCount).toBe(1)
  })

  it('user sees consecutive deltas flushed when streaming, then they arrive combined', async () => {
    vi.useFakeTimers()
    const { api, transport } = createTransport()
    const stream = await transport.sendMessages(sendOptions)
    const reader = stream.getReader()

    api.emit({
      type: 'chunk',
      requestId,
      chunk: { type: 'text-delta', id: 'part-1', delta: 'Hel' }
    })
    api.emit({
      type: 'chunk',
      requestId,
      chunk: { type: 'text-delta', id: 'part-1', delta: 'lo' }
    })

    await vi.advanceTimersByTimeAsync(16)

    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { type: 'text-delta', id: 'part-1', delta: 'Hello' }
    })

    api.emit({ type: 'finish', requestId })
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
    expect(api.unsubscribeCount).toBe(1)
  })

  it('user receives a full batch when it is ready to flush, then later deltas wait', async () => {
    vi.useFakeTimers()
    const { api, transport } = createTransport()
    const stream = await transport.sendMessages(sendOptions)
    const reader = stream.getReader()
    const batch = 'x'.repeat(4 * 1024)

    api.emit({
      type: 'chunk',
      requestId,
      chunk: { type: 'text-delta', id: 'part-1', delta: batch }
    })
    api.emit({
      type: 'chunk',
      requestId,
      chunk: { type: 'text-delta', id: 'part-1', delta: 'y' }
    })

    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { type: 'text-delta', id: 'part-1', delta: batch }
    })

    api.emit({ type: 'finish', requestId })
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { type: 'text-delta', id: 'part-1', delta: 'y' }
    })
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
  })

  it('user gets a pending batch dropped when aborted, then the stream ends', async () => {
    vi.useFakeTimers()
    const { api, transport } = createTransport()
    const abortController = new AbortController()
    const stream = await transport.sendMessages({
      ...sendOptions,
      abortSignal: abortController.signal
    })
    const reader = stream.getReader()

    api.emit({
      type: 'chunk',
      requestId,
      chunk: { type: 'text-delta', id: 'part-1', delta: 'Held back' }
    })
    abortController.abort()
    await vi.advanceTimersByTimeAsync(16)

    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
    expect(api.abortedRequestIds).toEqual([requestId])
    expect(api.unsubscribeCount).toBe(1)
  })

  it('user sees mismatched events ignored when IDs differ, then the stream stays open', async () => {
    const { api, transport } = createTransport(() => 'medium')
    const stream = await transport.sendMessages(sendOptions)
    const reader = stream.getReader()

    api.emit({
      type: 'chunk',
      requestId: 'request-2',
      chunk: { type: 'text-delta', id: 'part-2', delta: 'Ignored' }
    })
    api.emit({ type: 'finish', requestId: 'request-2' })

    let settled = false
    void reader.read().then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    api.emit({ type: 'finish', requestId })
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
  })

  it('user sees a safe error when the start fails, then the listener is released', async () => {
    const { api, transport } = createTransport()
    api.startTurn = vi.fn<ChatAPI['startTurn']>(async () => {
      throw new Error('sensitive IPC details')
    })
    const reader = (await transport.sendMessages(sendOptions)).getReader()

    await expect(reader.read()).rejects.toThrow('Unable to start chat. Please try again.')
    expect(api.unsubscribeCount).toBe(1)
  })

  it('user aborts the request when the signal fires, then the abort is forwarded once', async () => {
    const { api, transport } = createTransport(() => 'medium')
    const controller = new AbortController()

    await transport.sendMessages({ ...sendOptions, abortSignal: controller.signal })
    controller.abort()
    await Promise.resolve()

    expect(api.abortedRequestIds).toEqual([requestId])
    expect(api.unsubscribeCount).toBe(1)
  })
})
