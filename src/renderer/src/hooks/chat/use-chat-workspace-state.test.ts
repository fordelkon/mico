import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { ChatStreamEvent } from '@shared/data/schemas/chat'
import type { ChatAPI } from '@shared/ipc/schemas/chat'
import { useChatWorkspaceState } from './use-chat-workspace-state'

class FakeChatAPI implements ChatAPI {
  readonly startedRequests: Parameters<ChatAPI['start']>[0][] = []
  readonly listeners = new Set<Parameters<ChatAPI['onEvent']>[0]>()

  async abort(): Promise<void> {}

  onEvent(listener: Parameters<ChatAPI['onEvent']>[0]): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async start(request: Parameters<ChatAPI['start']>[0]): Promise<void> {
    this.startedRequests.push(request)
  }

  emit(event: ChatStreamEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

const originalApi = Object.getOwnPropertyDescriptor(window, 'api')

afterEach(() => {
  if (originalApi) Object.defineProperty(window, 'api', originalApi)
  else Reflect.deleteProperty(window, 'api')
})

describe('useChatWorkspaceState', () => {
  it('keeps a provider error on its conversation and clears it when the next send begins', async () => {
    const api = new FakeChatAPI()
    Object.defineProperty(window, 'api', { configurable: true, value: { chat: api } })
    const { result } = renderHook(() => useChatWorkspaceState())

    act(() => result.current.sendMessage('First message'))
    await waitFor(() => expect(api.startedRequests).toHaveLength(1))

    const conversationId = result.current.activeConversation?.id
    if (!conversationId) throw new Error('Sending a message must create an active conversation.')
    api.emit({
      type: 'error',
      requestId: api.startedRequests[0].requestId,
      message: 'The chat provider could not complete the response.'
    })

    await waitFor(() =>
      expect(result.current.response).toEqual({
        status: 'error',
        conversationId,
        message: 'The chat provider could not complete the response.'
      })
    )

    act(() => result.current.sendMessage('Second message'))
    await waitFor(() => expect(api.startedRequests).toHaveLength(2))
    expect(result.current.response).toMatchObject({ conversationId })
    expect(result.current.response.status).not.toBe('error')
  })
})
