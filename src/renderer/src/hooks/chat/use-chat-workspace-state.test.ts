import { act, renderHook, waitFor } from '@testing-library/react'
import { useChat } from '@ai-sdk/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelReasoningCapabilities } from '@shared/data/schemas/chat'
import type { ChatAPI, TurnStreamEvent } from '@shared/ipc/schemas/chat'
import type { SessionsAPI } from '@shared/ipc/schemas/sessions'
import { useChatWorkspaceState } from './use-chat-workspace-state'

class FakeChatAPI implements ChatAPI {
  readonly startedRequests: Parameters<ChatAPI['startTurn']>[0][] = []
  readonly listeners = new Set<Parameters<ChatAPI['onTurnEvent']>[0]>()
  readonly titleListeners = new Set<(update: { sessionId: string; title: string }) => void>()
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
          parts: [{ type: 'text' as const, text: 'Saved answer' }],
          metadata: { completionState: 'stopped' as const }
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
    }),
    setThinkingEffort: async (): Promise<void> => {},
    setModelEntry: async (): Promise<void> => {},
    onTitleUpdated: (listener: (update: { sessionId: string; title: string }) => void) => {
      this.titleListeners.add(listener)
      return () => this.titleListeners.delete(listener)
    }
  }

  async abortTurn(): Promise<void> {}

  async getCapabilities(): Promise<ModelReasoningCapabilities | null> {
    return null
  }

  onTurnEvent(listener: Parameters<ChatAPI['onTurnEvent']>[0]): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async startTurn(request: Parameters<ChatAPI['startTurn']>[0]): Promise<void> {
    this.startedRequests.push(request)
  }

  emit(event: TurnStreamEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  emitTitleUpdated(update: { sessionId: string; title: string }): void {
    for (const listener of this.titleListeners) listener(update)
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
  it('keeps streamed transcript updates out of workspace renders', async () => {
    vi.useFakeTimers()
    const api = new FakeChatAPI()
    exposeApi(api)
    let workspaceRenderCount = 0
    const { result } = renderHook(() => {
      workspaceRenderCount += 1
      return useChatWorkspaceState()
    })

    act(() => result.current.sendMessage('Hello'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const initialRequestId = api.startedRequests[0]?.requestId
    if (!initialRequestId) throw new Error('Sending a message must start a request.')
    const activeChat = result.current.activeChat
    if (!activeChat) throw new Error('Sending a message must create an active chat.')
    act(() => api.emit({ type: 'finish', requestId: initialRequestId }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const { result: transcript } = renderHook(() => useChat({ chat: activeChat, throttle: 50 }))
    act(() => result.current.sendMessage('Hello again'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const requestId = api.startedRequests[1]?.requestId
    if (!requestId) throw new Error('Sending another message must start a request.')

    act(() => {
      api.emit({ type: 'chunk', requestId, chunk: { type: 'text-start', id: 'part-1' } })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    const rendersBeforeTextDelta = workspaceRenderCount

    act(() => {
      api.emit({
        type: 'chunk',
        requestId,
        chunk: { type: 'text-delta', id: 'part-1', delta: 'Streamed answer' }
      })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(transcript.current.messages.at(-1)?.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'Streamed answer' })])
    )
    expect(workspaceRenderCount).toBe(rendersBeforeTextDelta)
  })

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
    expect(api.startedRequests[0]?.sessionId).toBe('session-new')
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
    await waitFor(() =>
      expect(result.current.respondingConversationIds).toEqual(new Set(['session-one']))
    )

    act(() => result.current.startNewChat())
    act(() => result.current.sendMessage('Second message'))

    await waitFor(() =>
      expect(result.current.respondingConversationIds).toEqual(
        new Set(['session-one', 'session-two'])
      )
    )

    api.emit({ type: 'finish', requestId: api.startedRequests[0].requestId })

    await waitFor(() =>
      expect(result.current.respondingConversationIds).toEqual(new Set(['session-two']))
    )
  })

  it('keeps the responding conversation set stable when only response status changes', async () => {
    const api = new FakeChatAPI()
    exposeApi(api)
    const { result } = renderHook(() => useChatWorkspaceState())

    act(() => result.current.sendMessage('Hello'))
    await waitFor(() => expect(api.startedRequests).toHaveLength(1))
    const respondingConversationIds = result.current.respondingConversationIds

    act(() => {
      api.emit({
        type: 'chunk',
        requestId: api.startedRequests[0].requestId,
        chunk: { type: 'text-start', id: 'part-1' }
      })
    })

    await waitFor(() => expect(result.current.response.status).toBe('streaming'))
    expect(result.current.respondingConversationIds).toBe(respondingConversationIds)
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

    const initialRequestId = api.startedRequests[0]?.requestId
    if (!initialRequestId) throw new Error('Sending a message must start a request.')
    const activeChat = result.current.activeChat
    if (!activeChat) throw new Error('Sending a message must create an active chat.')
    act(() => api.emit({ type: 'finish', requestId: initialRequestId }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const { result: transcript } = renderHook(() => useChat({ chat: activeChat, throttle: 50 }))
    act(() => result.current.sendMessage('Hello again'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const requestId = api.startedRequests[1]?.requestId
    if (!requestId) throw new Error('Sending another message must start a request.')

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
    expect(transcript.current.messages.at(-1)?.parts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'rapid updates' })])
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(transcript.current.messages.at(-1)?.parts).toEqual(
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
        result.current.activeChat?.messages.map(({ metadata, parts, role }) => ({
          completionState: metadata?.completionState,
          role,
          text: parts.find((part) => part.type === 'text')?.text
        }))
      ).toEqual([
        { completionState: undefined, role: 'user', text: 'Saved prompt' },
        { completionState: 'stopped', role: 'assistant', text: 'Saved answer' }
      ])
    )
  })

  it('restores the cached session model selection after opening a new chat', async () => {
    const api = new FakeChatAPI()
    api.sessions.list = async () => [
      {
        id: 'session-1',
        title: 'Saved chat',
        defaultProfile: {
          modelEntryId: 'ollama:qwen3',
          providerId: 'ollama',
          modelId: 'qwen3:8b',
          thinkingEffort: 'high',
          configurationDigest: 'saved-configuration'
        },
        createdAt: 1,
        updatedAt: 2,
        lastActivityAt: 2
      }
    ]
    api.sessions.load = async () => ({
      id: 'session-1',
      title: 'Saved chat',
      defaultProfile: {
        modelEntryId: 'ollama:qwen3',
        providerId: 'ollama',
        modelId: 'qwen3:8b',
        thinkingEffort: 'high',
        configurationDigest: 'saved-configuration'
      },
      createdAt: 1,
      updatedAt: 2,
      lastActivityAt: 2,
      messages: []
    })
    exposeApi(api)
    const { result } = renderHook(() => useChatWorkspaceState())

    await waitFor(() => expect(result.current.conversations).toHaveLength(1))
    act(() => result.current.selectConversation('session-1'))
    await waitFor(() => expect(result.current.selectedModelEntryId).toBe('ollama:qwen3'))

    act(() => result.current.startNewChat())
    act(() => result.current.selectConversation('session-1'))

    expect(result.current.selectedModelEntryId).toBe('ollama:qwen3')
    expect(result.current.thinkingEffort).toBe('high')
  })

  it('persists a manual conversation rename before updating the sidebar title', async () => {
    const api = new FakeChatAPI()
    const rename = vi.fn(async ({ sessionId, title }: { sessionId: string; title: string }) => ({
      id: sessionId,
      title,
      defaultProfile: null,
      createdAt: 1,
      updatedAt: 3,
      lastActivityAt: 2
    }))
    api.sessions.rename = rename
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
    act(() => result.current.renameConversation('session-1', 'Renamed chat'))

    await waitFor(() =>
      expect(rename).toHaveBeenCalledWith({ sessionId: 'session-1', title: 'Renamed chat' })
    )
    await waitFor(() =>
      expect(result.current.conversations).toEqual([{ id: 'session-1', title: 'Renamed chat' }])
    )
  })

  it('updates the sidebar when the main process generates a conversation title', async () => {
    const api = new FakeChatAPI()
    api.sessions.list = async () => [
      {
        id: 'session-1',
        title: 'New chat',
        defaultProfile: null,
        createdAt: 1,
        updatedAt: 2,
        lastActivityAt: 2
      }
    ]
    exposeApi(api)
    const { result } = renderHook(() => useChatWorkspaceState())

    await waitFor(() => expect(result.current.conversations).toHaveLength(1))
    act(() => api.emitTitleUpdated({ sessionId: 'session-1', title: 'Plan release notes' }))

    await waitFor(() =>
      expect(result.current.conversations).toEqual([
        { id: 'session-1', title: 'Plan release notes' }
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
