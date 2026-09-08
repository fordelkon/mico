import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChatStreamEvent, ModelReasoningCapabilities } from '@shared/data/schemas/chat'
import type { ChatAPI } from '@shared/ipc/schemas/chat'
import { useChatWorkspaceState } from './use-chat-workspace-state'

class FakeChatAPI implements ChatAPI {
  readonly startedRequests: Parameters<ChatAPI['start']>[0][] = []
  readonly listeners = new Set<Parameters<ChatAPI['onEvent']>[0]>()

  async abort(): Promise<void> {}

  async getCapabilities(): Promise<ModelReasoningCapabilities | null> {
    return null
  }

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
  vi.useRealTimers()
  if (originalApi) Object.defineProperty(window, 'api', originalApi)
  else Reflect.deleteProperty(window, 'api')
})

describe('useChatWorkspaceState', () => {
  it('resets a selection that is absent from loaded capabilities', async () => {
    const api = new FakeChatAPI()
    let resolveCapabilities: (capabilities: ModelReasoningCapabilities | null) => void
    const capabilities = new Promise<ModelReasoningCapabilities | null>((resolve) => {
      resolveCapabilities = resolve
    })
    api.getCapabilities = () => capabilities
    Object.defineProperty(window, 'api', { configurable: true, value: { chat: api } })
    const { result } = renderHook(() => useChatWorkspaceState())

    act(() => result.current.setThinkingEffort('high'))
    await act(async () => {
      resolveCapabilities({ selectableEfforts: ['low', 'medium'], defaultEffort: 'low' })
      await capabilities
    })

    expect(result.current.reasoningCapabilities).toEqual({
      selectableEfforts: ['low', 'medium'],
      defaultEffort: 'low'
    })
    expect(result.current.thinkingEffort).toBe('low')
  })

  it('uses default when capability loading fails without blocking a send', async () => {
    const api = new FakeChatAPI()
    api.getCapabilities = async () => {
      throw new Error('offline')
    }
    Object.defineProperty(window, 'api', { configurable: true, value: { chat: api } })
    const { result } = renderHook(() => useChatWorkspaceState())

    await waitFor(() => expect(result.current.reasoningCapabilities).toBeNull())

    act(() => result.current.sendMessage('Hello'))
    await waitFor(() => expect(api.startedRequests[0]?.thinkingEffort).toBe('default'))
  })

  it('batches rapid streamed text updates before committing the transcript', async () => {
    vi.useFakeTimers()
    const api = new FakeChatAPI()
    Object.defineProperty(window, 'api', { configurable: true, value: { chat: api } })
    const { result } = renderHook(() => useChatWorkspaceState())

    act(() => result.current.sendMessage('Hello'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const requestId = api.startedRequests[0]?.requestId
    if (!requestId) throw new Error('Sending a message must start a request.')

    act(() => {
      api.emit({
        type: 'chunk',
        requestId,
        chunk: { type: 'text-start', id: 'part-1' }
      })
      api.emit({
        type: 'chunk',
        requestId,
        chunk: { type: 'text-delta', id: 'part-1', delta: 'rapid ' }
      })
      api.emit({
        type: 'chunk',
        requestId,
        chunk: { type: 'text-delta', id: 'part-1', delta: 'updates' }
      })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(49)
    })
    expect(result.current.activeMessages.at(-1)?.parts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'rapid updates' })])
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(result.current.activeMessages.at(-1)?.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'rapid updates' })])
    )
  })

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
