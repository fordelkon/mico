import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChatStreamEvent, ModelReasoningCapabilities } from '@shared/data/schemas/chat'
import type { ChatAPI } from '@shared/ipc/schemas/chat'
import type { SessionsAPI } from '@shared/ipc/schemas/sessions'
import { useChatWorkspaceState } from './use-chat-workspace-state'

class FakeChatAPI implements ChatAPI {
  readonly startedRequests: Parameters<ChatAPI['start']>[0][] = []
  readonly listeners = new Set<Parameters<ChatAPI['onEvent']>[0]>()
  readonly createSession = vi.fn(async (_input: { title: string }) => ({
    id: 'session-new',
    title: 'New chat',
    defaultProfile: null,
    createdAt: 1,
    updatedAt: 1,
    lastActivityAt: 1
  }))
  readonly sessions: SessionsAPI = {
    create: (input) => this.createSession(input),
    delete: async (): Promise<void> => {},
    list: async () => [],
    load: async () => ({
      id: 'session-1',
      title: 'Saved chat',
      defaultProfile: null,
      createdAt: 1,
      updatedAt: 2,
      lastActivityAt: 2,
      messages: [
        { role: 'user' as const, parts: [{ type: 'text' as const, text: 'Saved prompt' }] },
        {
          role: 'assistant' as const,
          parts: [{ type: 'text' as const, text: 'Saved answer' }]
        }
      ]
    }),
    rename: async () => ({
      id: 'session-1',
      title: 'Renamed chat',
      defaultProfile: null,
      createdAt: 1,
      updatedAt: 3,
      lastActivityAt: 2
    })
  }

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

function exposeApi(chat: FakeChatAPI): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { chat, sessions: chat.sessions }
  })
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
    exposeApi(api)
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
    exposeApi(api)
    const { result } = renderHook(() => useChatWorkspaceState())

    await waitFor(() => expect(result.current.reasoningCapabilities).toBeNull())

    act(() => result.current.sendMessage('Hello'))
    await waitFor(() => expect(api.startedRequests[0]?.thinkingEffort).toBe('default'))
  })

  it('uses the persisted session ID when sending the first message', async () => {
    const api = new FakeChatAPI()
    exposeApi(api)
    const { result } = renderHook(() => useChatWorkspaceState())

    act(() => result.current.sendMessage('Hello'))

    await waitFor(() => expect(api.startedRequests).toHaveLength(1))
    expect(api.createSession).toHaveBeenCalledOnce()
    expect(api.createSession).toHaveBeenCalledWith({ title: 'New chat' })
    expect(api.startedRequests[0]?.conversationId).toBe('session-new')
  })

  it('tracks concurrent responses independently when starting a new chat', async () => {
    const api = new FakeChatAPI()
    const sessionIds = ['session-one', 'session-two']
    api.createSession.mockImplementation(async () => ({
      id: sessionIds.shift() ?? 'unexpected-session',
      title: 'New chat',
      defaultProfile: null,
      createdAt: 1,
      updatedAt: 1,
      lastActivityAt: 1
    }))
    exposeApi(api)
    const { result } = renderHook(() => useChatWorkspaceState())

    act(() => result.current.sendMessage('First message'))
    await waitFor(() => expect(result.current.respondingConversationIds).toEqual(['session-one']))

    act(() => result.current.startNewChat())
    act(() => result.current.sendMessage('Second message'))

    await waitFor(() =>
      expect(result.current.respondingConversationIds).toEqual(['session-one', 'session-two'])
    )

    api.emit({ type: 'finish', requestId: api.startedRequests[0].requestId })

    await waitFor(() => expect(result.current.respondingConversationIds).toEqual(['session-two']))
  })

  it('batches rapid streamed text updates before committing the transcript', async () => {
    vi.useFakeTimers()
    const api = new FakeChatAPI()
    exposeApi(api)
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
    exposeApi(api)
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

  it('hydrates a selected saved session with its persisted messages', async () => {
    const api = new FakeChatAPI()
    api.sessions.list = async () => [
      {
        id: 'session-1',
        title: 'Saved chat',
        defaultProfile: null,
        createdAt: 1,
        updatedAt: 2,
        lastActivityAt: 2
      }
    ]
    exposeApi(api)
    const { result } = renderHook(() => useChatWorkspaceState())

    await waitFor(() =>
      expect(result.current.conversations).toEqual([{ id: 'session-1', title: 'Saved chat' }])
    )
    act(() => result.current.selectConversation('session-1'))

    await waitFor(() =>
      expect(
        result.current.activeMessages.map(({ parts, role }) => ({
          role,
          text: parts.find((part) => part.type === 'text')?.text
        }))
      ).toEqual([
        { role: 'user', text: 'Saved prompt' },
        { role: 'assistant', text: 'Saved answer' }
      ])
    )
  })

  it('permanently deletes a persisted session after the delete request succeeds', async () => {
    const api = new FakeChatAPI()
    const remove = vi.fn(async (): Promise<void> => {})
    api.sessions.delete = remove
    api.sessions.list = async () => [
      {
        id: 'session-1',
        title: 'Saved chat',
        defaultProfile: null,
        createdAt: 1,
        updatedAt: 2,
        lastActivityAt: 2
      }
    ]
    exposeApi(api)
    const { result } = renderHook(() => useChatWorkspaceState())

    await waitFor(() => expect(result.current.conversations).toHaveLength(1))
    act(() => result.current.deleteConversation('session-1'))

    await waitFor(() => expect(remove).toHaveBeenCalledWith('session-1'))
    await waitFor(() => expect(result.current.conversations).toEqual([]))
  })
})
