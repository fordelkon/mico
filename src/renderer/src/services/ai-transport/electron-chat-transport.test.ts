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
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(requestId)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('ElectronChatTransport', () => {
  it.each(['submit-message', 'regenerate-message'] as const)(
    'preserves attached documents for %s',
    async (trigger) => {
      const api = new FakeChatAPI()
      const transport = new ElectronChatTransport(api, {
        sessionId: 'conversation-1',
        getThinkingEffort: () => 'default'
      })
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

  it('allows a document-only user message', async () => {
    const api = new FakeChatAPI()
    const transport = new ElectronChatTransport(api, {
      sessionId: 'conversation-1',
      getThinkingEffort: () => 'default'
    })
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

  it('takes the selection once when sendMessages starts', async () => {
    const api = new FakeChatAPI()
    let effort: ThinkingSelection = 'low'
    const transport = new ElectronChatTransport(api, {
      sessionId: 'conversation-1',
      getThinkingEffort: () => effort
    })

    const stream = await transport.sendMessages(sendOptions)
    effort = 'high'

    expect(api.startedRequests[0]).toMatchObject({
      sessionId: 'conversation-1',
      thinkingEffort: 'low'
    })

    await stream.cancel()
  })

  it('sends only the latest user message across IPC', async () => {
    const api = new FakeChatAPI()
    const transport = new ElectronChatTransport(api, {
      sessionId: 'conversation-1',
      getThinkingEffort: () => 'default'
    })

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

  it('marks regenerate requests as retries across IPC', async () => {
    const api = new FakeChatAPI()
    const transport = new ElectronChatTransport(api, {
      sessionId: 'conversation-1',
      getThinkingEffort: () => 'default'
    })

    const stream = await transport.sendMessages({
      ...sendOptions,
      trigger: 'regenerate-message'
    })

    expect(api.startedRequests[0]).toMatchObject({ retry: true })

    await stream.cancel()
  })

  it('forwards matching chunks and closes when the matching request finishes', async () => {
    const api = new FakeChatAPI()
    const transport = new ElectronChatTransport(api, {
      sessionId: 'conversation-1',
      getThinkingEffort: () => 'default'
    })
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

  it('closes when the main process explicitly cancels the matching request', async () => {
    const api = new FakeChatAPI()
    const transport = new ElectronChatTransport(api, {
      sessionId: 'conversation-1',
      getThinkingEffort: () => 'default'
    })
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

  it('flushes consecutive text deltas while the stream remains open', async () => {
    vi.useFakeTimers()
    const api = new FakeChatAPI()
    const transport = new ElectronChatTransport(api, {
      sessionId: 'conversation-1',
      getThinkingEffort: () => 'default'
    })
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

  it('flushes a full text batch before buffering more streamed content', async () => {
    vi.useFakeTimers()
    const api = new FakeChatAPI()
    const transport = new ElectronChatTransport(api, {
      sessionId: 'conversation-1',
      getThinkingEffort: () => 'default'
    })
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

  it('drops a pending text batch when its request is aborted', async () => {
    vi.useFakeTimers()
    const api = new FakeChatAPI()
    const abortController = new AbortController()
    const transport = new ElectronChatTransport(api, {
      sessionId: 'conversation-1',
      getThinkingEffort: () => 'default'
    })
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

  it('ignores events for a different request ID', async () => {
    const api = new FakeChatAPI()
    const transport = new ElectronChatTransport(api, {
      sessionId: 'conversation-1',
      getThinkingEffort: () => 'medium'
    })
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

  it('reports a safe error and releases its listener when IPC cannot start the request', async () => {
    const api = new FakeChatAPI()
    api.startTurn = vi.fn(async () => {
      throw new Error('sensitive IPC details')
    })
    const transport = new ElectronChatTransport(api, {
      sessionId: 'conversation-1',
      getThinkingEffort: () => 'default'
    })
    const reader = (await transport.sendMessages(sendOptions)).getReader()

    await expect(reader.read()).rejects.toThrow('Unable to start chat. Please try again.')
    expect(api.unsubscribeCount).toBe(1)
  })

  it('aborts its request and removes its event listener once', async () => {
    const api = new FakeChatAPI()
    const controller = new AbortController()
    const transport = new ElectronChatTransport(api, {
      sessionId: 'conversation-1',
      getThinkingEffort: () => 'medium'
    })

    await transport.sendMessages({ ...sendOptions, abortSignal: controller.signal })
    controller.abort()
    await Promise.resolve()

    expect(api.abortedRequestIds).toEqual([requestId])
    expect(api.unsubscribeCount).toBe(1)
  })
})
