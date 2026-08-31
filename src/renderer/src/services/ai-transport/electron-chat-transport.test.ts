import type { ChatTransport } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type { ChatStreamEvent } from '@shared/data/schemas/chat'
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
  it('forwards matching chunks and closes when the matching request finishes', async () => {
    const api = new FakeChatAPI()
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(requestId)
    const transport = new ElectronChatTransport(api)
    const stream = await transport.sendMessages(sendOptions)
    const reader = stream.getReader()

    const chunkRead = reader.read()
    api.emit({
      type: 'chunk',
      requestId,
      chunk: { type: 'text-delta', id: 'part-1', delta: 'Hi' }
    })

    await expect(chunkRead).resolves.toEqual({
      done: false,
      value: { type: 'text-delta', id: 'part-1', delta: 'Hi' }
    })

    const finishRead = reader.read()
    api.emit({ type: 'finish', requestId })
    await expect(finishRead).resolves.toEqual({ done: true, value: undefined })
    expect(api.startedRequests).toEqual([{ requestId, messages: [] }])
    expect(api.unsubscribeCount).toBe(1)

    uuid.mockRestore()
  })

  it('ignores events for a different request ID', async () => {
    const api = new FakeChatAPI()
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(requestId)
    const transport = new ElectronChatTransport(api)
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
    const transport = new ElectronChatTransport(api)

    await transport.sendMessages({ ...sendOptions, abortSignal: controller.signal })
    controller.abort()
    await Promise.resolve()

    expect(api.abortedRequestIds).toEqual([requestId])
    expect(api.unsubscribeCount).toBe(1)

    uuid.mockRestore()
  })
})
