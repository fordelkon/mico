import type { ChatTransport } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type { ChatStreamEvent } from '@shared/data/schemas/chat'
import type { ThinkingSelection } from '@shared/data/schemas/chat'
import type { ChatAPI } from '@shared/ipc/schemas/chat'
import type { MicoUIMessage } from '@renderer/types/chat'
import { ElectronChatTransport } from './electron-chat-transport'

class FakeChatAPI implements ChatAPI {
  readonly abortedRequestIds: string[] = []
  readonly startedRequests: Parameters<ChatAPI['start']>[0][] = []
  readonly listeners = new Set<Parameters<ChatAPI['onEvent']>[0]>()
  unsubscribeCount = 0

  async abort(requestId: string): Promise<void> {
    this.abortedRequestIds.push(requestId)
  }

  async getCapabilities(): Promise<null> {
    return null
  }

  onEvent(listener: Parameters<ChatAPI['onEvent']>[0]): () => void {
    this.listeners.add(listener)
    return () => {
      this.unsubscribeCount += 1
      this.listeners.delete(listener)
    }
  }

  async start(request: Parameters<ChatAPI['start']>[0]): Promise<void> {
    this.startedRequests.push(request)
  }

  emit(event: ChatStreamEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

const requestId = '00000000-0000-4000-8000-000000000001'
const sendOptions: Parameters<ChatTransport<MicoUIMessage>['sendMessages']>[0] = {
  abortSignal: undefined,
  chatId: 'conversation-1',
  messageId: undefined,
  messages: [],
  trigger: 'submit-message'
}

describe('ElectronChatTransport', () => {
  it('takes the selection once when sendMessages starts', async () => {
    const api = new FakeChatAPI()
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(requestId)
    let effort: ThinkingSelection = 'low'
    const transport = new ElectronChatTransport(api, {
      conversationId: 'conversation-1',
      getThinkingEffort: () => effort
    })

    const stream = await transport.sendMessages(sendOptions)
    effort = 'high'

    expect(api.startedRequests[0]).toMatchObject({
      conversationId: 'conversation-1',
      thinkingEffort: 'low'
    })

    await stream.cancel()
    uuid.mockRestore()
  })

  it('preserves reasoning parts and replay metadata in the next provider request', async () => {
    const api = new FakeChatAPI()
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(requestId)
    const transport = new ElectronChatTransport(api, {
      conversationId: 'conversation-1',
      getThinkingEffort: () => 'default'
    })

    const stream = await transport.sendMessages({
      ...sendOptions,
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [
            {
              type: 'reasoning',
              text: 'Inspect the request.',
              providerMetadata: { anthropic: { signature: 'sig-1' } }
            },
            { type: 'text', text: 'Done.' }
          ]
        }
      ]
    })

    expect(api.startedRequests[0]?.messages).toEqual([
      {
        role: 'assistant',
        parts: [
          {
            type: 'reasoning',
            text: 'Inspect the request.',
            providerMetadata: { anthropic: { signature: 'sig-1' } }
          },
          { type: 'text', text: 'Done.' }
        ]
      }
    ])

    await stream.cancel()
    uuid.mockRestore()
  })

  it('forwards matching chunks and closes when the matching request finishes', async () => {
    const api = new FakeChatAPI()
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(requestId)
    const transport = new ElectronChatTransport(api, {
      conversationId: 'conversation-1',
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
      { conversationId: 'conversation-1', requestId, messages: [], thinkingEffort: 'default' }
    ])
    expect(api.unsubscribeCount).toBe(1)

    uuid.mockRestore()
  })

  it('flushes consecutive text deltas while the stream remains open', async () => {
    vi.useFakeTimers()
    const api = new FakeChatAPI()
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(requestId)
    const transport = new ElectronChatTransport(api, {
      conversationId: 'conversation-1',
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

    uuid.mockRestore()
    vi.useRealTimers()
  })

  it('flushes a full text batch before buffering more streamed content', async () => {
    vi.useFakeTimers()
    const api = new FakeChatAPI()
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(requestId)
    const transport = new ElectronChatTransport(api, {
      conversationId: 'conversation-1',
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

    uuid.mockRestore()
    vi.useRealTimers()
  })

  it('drops a pending text batch when its request is aborted', async () => {
    vi.useFakeTimers()
    const api = new FakeChatAPI()
    const abortController = new AbortController()
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(requestId)
    const transport = new ElectronChatTransport(api, {
      conversationId: 'conversation-1',
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

    uuid.mockRestore()
    vi.useRealTimers()
  })

  it('ignores events for a different request ID', async () => {
    const api = new FakeChatAPI()
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(requestId)
    const transport = new ElectronChatTransport(api, {
      conversationId: 'conversation-1',
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

    uuid.mockRestore()
  })

  it('aborts its request and removes its event listener once', async () => {
    const api = new FakeChatAPI()
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(requestId)
    const controller = new AbortController()
    const transport = new ElectronChatTransport(api, {
      conversationId: 'conversation-1',
      getThinkingEffort: () => 'medium'
    })

    await transport.sendMessages({ ...sendOptions, abortSignal: controller.signal })
    controller.abort()
    await Promise.resolve()

    expect(api.abortedRequestIds).toEqual([requestId])
    expect(api.unsubscribeCount).toBe(1)

    uuid.mockRestore()
  })
})
