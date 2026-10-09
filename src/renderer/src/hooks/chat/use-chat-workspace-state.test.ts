import { useChat } from '@ai-sdk/react'
import type { ModelReasoningCapabilities } from '@shared/data/schemas/chat'
import type { WorkspaceProject } from '@shared/data/schemas/workspace'
import type { ChatAPI, TurnStreamEvent } from '@shared/ipc/schemas/chat'
import type { SessionsAPI } from '@shared/ipc/schemas/sessions'
import type { WorkspacesAPI } from '@shared/ipc/schemas/workspaces'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChatWorkspaceState } from './use-chat-workspace-state'

class FakeChatAPI implements ChatAPI {
  async getSkillCatalog(): Promise<Awaited<ReturnType<ChatAPI['getSkillCatalog']>>> {
    return { skills: [], diagnostics: [] }
  }
  async respondToPermission(): Promise<void> {}
  readonly startedRequests: Parameters<ChatAPI['startTurn']>[0][] = []
  readonly listeners = new Set<Parameters<ChatAPI['onTurnEvent']>[0]>()
  readonly titleListeners = new Set<(update: { sessionId: string; title: string }) => void>()
  readonly createSession = vi.fn<SessionsAPI['create']>(async (_input: { title: string }) => ({
    id: 'session-new',
    title: 'New chat',
    defaultProfile: null,
    createdAt: 1,
    updatedAt: 1,
    lastActivityAt: 1
  }))
  readonly addProjectFromDialog = vi.fn<WorkspacesAPI['addFromDialog']>(async () => ({
    id: 'project-1',
    name: 'Project one',
    rootPath: '/projects/one',
    isDefault: false
  }))
  workspaceProjects: WorkspaceProject[] = []
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
    value: {
      chat,
      sessions: chat.sessions,
      workspaces: {
        addFromDialog: () => chat.addProjectFromDialog(),
        list: async () => chat.workspaceProjects
      }
    }
  })
}

function renderWorkspaceState(configure?: (api: FakeChatAPI) => void) {
  const api = new FakeChatAPI()
  configure?.(api)
  exposeApi(api)
  const rendered = renderHook(() => useChatWorkspaceState())
  return { api, ...rendered }
}

const originalApi = Object.getOwnPropertyDescriptor(window, 'api')

afterEach(() => {
  vi.useRealTimers()
  if (originalApi) Object.defineProperty(window, 'api', originalApi)
  else Reflect.deleteProperty(window, 'api')
})

describe('useChatWorkspaceState', () => {
  it('user navigates when first-send creation is delayed, then the new response stays in the background', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<SessionsAPI['create']>>>()
    const { api, result } = renderWorkspaceState((api) => {
      api.createSession.mockImplementationOnce(() => pending.promise)
    })
    let sending: Promise<boolean>
    act(() => {
      sending = result.current.responses.sendMessage({ text: 'First message', documents: [] })
    })
    act(() => result.current.session.selectConversation('session-1'))
    await waitFor(() =>
      expect(result.current.session.activeSession?.conversationId).toBe('session-1')
    )
    await act(async () => {
      pending.resolve({
        id: 'session-new',
        title: 'New chat',
        defaultProfile: null,
        createdAt: 1,
        updatedAt: 1,
        lastActivityAt: 1
      })
      await sending
    })
    expect(result.current.session.activeSession?.conversationId).toBe('session-1')
    await waitFor(() => expect(api.startedRequests[0]?.sessionId).toBe('session-new'))
  })

  it('user leaves a conversation when its model refresh callback resumes, then the current capabilities stay selected', async () => {
    const capabilities = Promise.withResolvers<ModelReasoningCapabilities | null>()
    const { result } = renderWorkspaceState((api) => {
      const load = api.sessions.load
      api.sessions.load = async (id) => ({ ...(await load(id)), id })
      api.getCapabilities = async (sessionId?: string) =>
        sessionId === 'second'
          ? capabilities.promise
          : { selectableEfforts: ['low'], defaultEffort: 'low' }
    })
    act(() => result.current.session.selectConversation('first'))
    await waitFor(() => expect(result.current.session.activeSession?.conversationId).toBe('first'))
    const previousRefresh = result.current.session.refreshCapabilities
    act(() => result.current.session.selectConversation('second'))
    await waitFor(() => expect(result.current.session.activeSession?.conversationId).toBe('second'))
    act(() => result.current.session.setThinkingEffort('high'))
    await act(async () => {
      await previousRefresh()
      capabilities.resolve({ selectableEfforts: ['high'], defaultEffort: 'high' })
      await capabilities.promise
    })
    expect(result.current.session.reasoningCapabilities).toEqual({
      selectableEfforts: ['high'],
      defaultEffort: 'high'
    })
    expect(result.current.session.thinkingEffort).toBe('high')
  })

  it('user changes to a model without reasoning when refreshing capabilities, then effort resets', async () => {
    const { result } = renderWorkspaceState()
    act(() => result.current.session.setThinkingEffort('high'))
    await act(async () => {
      await result.current.session.refreshCapabilities()
    })
    expect(result.current.session.thinkingEffort).toBe('none')
  })

  it('user selects two conversations when loads finish in reverse, then the latest selection stays active', async () => {
    const first = Promise.withResolvers<Awaited<ReturnType<SessionsAPI['load']>>>()
    const second = Promise.withResolvers<Awaited<ReturnType<SessionsAPI['load']>>>()
    const { api, result } = renderWorkspaceState((api) => {
      api.sessions.load = (id) => (id === 'first' ? first.promise : second.promise)
    })
    const saved = {
      id: 'second',
      title: 'Second',
      defaultProfile: null,
      createdAt: 1,
      updatedAt: 1,
      lastActivityAt: 1,
      messages: []
    }
    act(() => {
      result.current.session.selectConversation('first')
      result.current.session.selectConversation('second')
    })
    await act(async () => {
      second.resolve(saved)
      await second.promise
    })
    await waitFor(() => expect(result.current.session.activeSession?.conversationId).toBe('second'))
    await act(async () => {
      first.resolve({ ...saved, id: 'first', title: 'First' })
      await first.promise
    })
    expect(result.current.session.activeSession?.conversationId).toBe('second')
    expect(api.startedRequests).toEqual([])
  })

  it('user starts a new chat when a saved conversation is loading, then its late load cannot reopen it', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<SessionsAPI['load']>>>()
    const { result } = renderWorkspaceState((api) => {
      api.sessions.load = () => pending.promise
    })
    act(() => {
      result.current.session.selectConversation('saved')
      result.current.session.startNewChat()
    })
    await act(async () => {
      pending.resolve({
        id: 'saved',
        title: 'Saved',
        defaultProfile: null,
        createdAt: 1,
        updatedAt: 1,
        lastActivityAt: 1,
        messages: []
      })
      await pending.promise
    })
    expect(result.current.session.activeSession).toBeNull()
  })

  it('user changes a model then navigates when saving is delayed, then the new conversation keeps its model', async () => {
    const pending = Promise.withResolvers<void>()
    const { result } = renderWorkspaceState((api) => {
      const load = api.sessions.load
      api.sessions.load = async (id) => ({
        ...(await load(id)),
        id,
        defaultProfile: {
          modelEntryId: `${id}-model`,
          modelId: 'model',
          providerId: 'provider',
          thinkingEffort: 'high',
          configurationDigest: 'digest'
        }
      })
      api.sessions.setModelEntry = () => pending.promise
    })
    act(() => result.current.session.selectConversation('first'))
    await waitFor(() => expect(result.current.session.activeSession?.conversationId).toBe('first'))
    const change = result.current.session.setSessionModelEntry('changed')
    act(() => result.current.session.selectConversation('second'))
    await waitFor(() => expect(result.current.session.activeSession?.conversationId).toBe('second'))
    await act(async () => {
      pending.resolve()
      await change
    })
    expect(result.current.session.selectedModelEntryId).toBe('second-model')
    act(() => result.current.session.selectConversation('first'))
    expect(result.current.session.selectedModelEntryId).toBe('changed')
  })

  it('user retries a background conversation when another is selected, then it uses its own thinking effort', async () => {
    const { api, result } = renderWorkspaceState((api) => {
      const load = api.sessions.load
      api.sessions.load = async (id) => ({ ...(await load(id)), id })
    })
    act(() => result.current.session.selectConversation('first'))
    await waitFor(() => expect(result.current.session.activeSession?.conversationId).toBe('first'))
    act(() => result.current.session.setThinkingEffort('high'))
    const background = result.current.session.activeChat
    act(() => result.current.session.selectConversation('second'))
    await waitFor(() => expect(result.current.session.activeSession?.conversationId).toBe('second'))
    act(() => result.current.session.setThinkingEffort('low'))
    act(() => {
      void background?.regenerate()
    })
    await waitFor(() => expect(api.startedRequests).toHaveLength(1))
    expect(api.startedRequests[0]).toMatchObject({ sessionId: 'first', thinkingEffort: 'high' })
  })

  it('user cannot load a conversation when storage fails, then a retry message appears', async () => {
    const { result } = renderWorkspaceState((api) => {
      api.sessions.load = async () => {
        throw new Error('Storage unavailable')
      }
    })
    act(() => result.current.session.selectConversation('saved'))
    await waitFor(() =>
      expect(result.current.session.activationError).toBe(
        'Could not open this conversation. Select it again to retry.'
      )
    )
    expect(result.current.session.activeSession).toBeNull()
  })

  it('user reloads project history when sessions are listed, then workspace metadata is retained', async () => {
    const savedSession = {
      id: 'session-1',
      title: 'Saved chat',
      projectId: 'mico',
      cwd: '/projects/mico',
      defaultProfile: null,
      createdAt: 1,
      updatedAt: 2,
      lastActivityAt: 2
    }
    const { result } = renderWorkspaceState((api) => {
      api.sessions.list = async () => [savedSession]
    })

    await waitFor(() => expect(result.current.conversations).toHaveLength(1))

    expect(result.current.conversations[0]).toMatchObject({
      id: 'session-1',
      projectId: 'mico',
      cwd: '/projects/mico',
      lastActivityAt: 2
    })
  })

  it('user starts new chats in the default workspace when sending, then it is used', async () => {
    const { api, result } = renderWorkspaceState((api) => {
      api.workspaceProjects = [
        {
          id: 'project-1',
          name: 'Archived never shown',
          rootPath: '/projects/one',
          isDefault: false
        },
        { id: 'project-2', name: 'Default workspace', rootPath: '/projects/two', isDefault: true }
      ]
    })

    await waitFor(() =>
      expect(result.current.session.activeProject).toMatchObject({
        id: 'project-2',
        name: 'Default workspace'
      })
    )

    await act(async () => {
      expect(await result.current.responses.sendMessage({ text: 'Hello', documents: [] })).toBe(
        true
      )
    })

    expect(api.createSession).toHaveBeenCalledWith({ title: 'New chat', projectId: 'project-2' })
  })

  it('user cannot send another turn when one is responding, then the send is declined', async () => {
    const { api, result } = renderWorkspaceState()
    const content = {
      text: '',
      documents: [{ type: 'document' as const, name: 'index.ts', text: 'export {}' }]
    }

    await act(async () => {
      expect(await result.current.responses.sendMessage(content)).toBe(true)
    })
    await waitFor(() => expect(api.startedRequests).toHaveLength(1))
    await act(async () => {
      expect(await result.current.responses.sendMessage(content)).toBe(false)
    })
    expect(api.startedRequests).toHaveLength(1)
  })

  it('user submits twice before the next render when a session is open, then only one request starts', async () => {
    const { api, result } = renderWorkspaceState()
    act(() => result.current.session.selectConversation('session-1'))
    await waitFor(() => expect(result.current.session.activeChat).not.toBeNull())

    await act(async () => {
      const first = result.current.responses.sendMessage({ text: 'First', documents: [] })
      const second = result.current.responses.sendMessage({ text: 'Second', documents: [] })
      expect(await first).toBe(true)
      expect(await second).toBe(false)
    })

    await waitFor(() => expect(api.startedRequests).toHaveLength(1))
    expect(api.startedRequests[0].userMessage.parts).toEqual([{ type: 'text', text: 'First' }])
  })

  it('user can resend when session creation fails, then the retry succeeds', async () => {
    let failCreation: ((reason: Error) => void) | undefined
    const { api, result } = renderWorkspaceState((api) => {
      api.createSession.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failCreation = reject
          })
      )
    })
    const content = {
      text: 'Review this file',
      documents: [{ type: 'document' as const, name: 'index.ts', text: 'export {}' }]
    }

    const pending = result.current.responses.sendMessage(content)
    expect(pending).toBeInstanceOf(Promise)
    await act(async () => {
      expect(await result.current.responses.sendMessage(content)).toBe(false)
      failCreation?.(new Error('Session storage unavailable'))
      await expect(pending).rejects.toThrow('Session storage unavailable')
    })
    expect(result.current.session.activeConversation).toBeNull()
    expect(api.startedRequests).toEqual([])

    await act(async () => {
      expect(await result.current.responses.sendMessage(content)).toBe(true)
    })
    await waitFor(() => expect(api.startedRequests).toHaveLength(1))
  })

  it.each([
    { existing: false, text: '' },
    { existing: false, text: 'Review this code' },
    { existing: true, text: '' },
    { existing: true, text: 'Review this code' }
  ])(
    'user sends documents with text "$text" when in an existing=$existing session, then the request carries them',
    async ({ existing, text }) => {
      const { api, result } = renderWorkspaceState()
      if (existing) act(() => result.current.session.selectConversation('session-1'))
      await waitFor(() => expect(Boolean(result.current.session.activeChat)).toBe(existing))

      await act(async () => {
        expect(
          await result.current.responses.sendMessage({
            text,
            documents: [{ type: 'document', name: 'index.ts', text: 'export {}' }]
          })
        ).toBe(true)
      })

      await waitFor(() => expect(api.startedRequests).toHaveLength(1))
      expect(api.startedRequests[0]).toMatchObject({
        sessionId: existing ? 'session-1' : 'session-new',
        userMessage: {
          role: 'user',
          parts: text
            ? [
                { type: 'text', text: 'Review this code' },
                { type: 'document', name: 'index.ts', text: 'export {}' }
              ]
            : [{ type: 'document', name: 'index.ts', text: 'export {}' }]
        }
      })
      expect(api.createSession).toHaveBeenCalledTimes(existing ? 0 : 1)
    }
  )

  it('user sends nothing when text and documents are empty, then no session is created', async () => {
    const { api, result } = renderWorkspaceState()

    await act(async () => result.current.responses.sendMessage({ text: '  ', documents: [] }))

    expect(api.createSession).not.toHaveBeenCalled()
    expect(api.startedRequests).toEqual([])
  })

  it('user keeps documents when regenerating, then the retry sends the original', async () => {
    const { api, result } = renderWorkspaceState((api) => {
      const loadSession = api.sessions.load
      api.sessions.load = async (sessionId) => ({
        ...(await loadSession(sessionId)),
        messages: [
          {
            role: 'user',
            parts: [{ type: 'document', name: 'index.ts', text: 'export {}' }]
          },
          { role: 'assistant', parts: [{ type: 'text', text: 'Saved answer' }] }
        ]
      })
    })
    act(() => result.current.session.selectConversation('session-1'))
    await waitFor(() => expect(result.current.session.activeChat).not.toBeNull())

    act(() => {
      void result.current.session.activeChat?.regenerate()
    })

    await waitFor(() => expect(api.startedRequests).toHaveLength(1))
    expect(api.startedRequests[0]).toMatchObject({
      sessionId: 'session-1',
      retry: true,
      userMessage: {
        role: 'user',
        parts: [{ type: 'document', name: 'index.ts', text: 'export {}' }]
      }
    })
  })

  it('user sees tool traces as chips when opening a saved session, then they appear', async () => {
    const { result } = renderWorkspaceState((api) => {
      api.sessions.load = async () => ({
        id: 'session-1',
        title: 'Saved chat',
        defaultProfile: null,
        createdAt: 1,
        updatedAt: 2,
        lastActivityAt: 2,
        messages: [
          { role: 'user' as const, parts: [{ type: 'text' as const, text: 'Read the file' }] },
          {
            role: 'assistant' as const,
            parts: [
              {
                type: 'tool-trace' as const,
                toolCallId: 'call-1',
                toolName: 'Read',
                input: { path: 'package.json' },
                state: 'output-available' as const,
                output: 'Read 1 line.'
              },
              { type: 'text' as const, text: 'Done' }
            ]
          }
        ]
      })
    })

    act(() => result.current.session.selectConversation('session-1'))

    await waitFor(() =>
      expect(result.current.session.activeChat?.messages.at(-1)?.parts).toMatchObject([
        {
          type: 'dynamic-tool',
          toolCallId: 'call-1',
          toolName: 'Read',
          input: { path: 'package.json' },
          state: 'output-available',
          output: 'Read 1 line.'
        },
        { type: 'text', text: 'Done' }
      ])
    )
  })

  it('user sees the effort reset when capabilities exclude it, then defaults are used', async () => {
    let resolveCapabilities: (capabilities: ModelReasoningCapabilities | null) => void
    const capabilities = new Promise<ModelReasoningCapabilities | null>((resolve) => {
      resolveCapabilities = resolve
    })
    const { result } = renderWorkspaceState((api) => {
      api.getCapabilities = () => capabilities
    })

    act(() => result.current.session.setThinkingEffort('high'))
    await act(async () => {
      resolveCapabilities({ selectableEfforts: ['low', 'medium'], defaultEffort: 'low' })
      await capabilities
    })

    expect(result.current.session.reasoningCapabilities).toEqual({
      selectableEfforts: ['low', 'medium'],
      defaultEffort: 'low'
    })
    expect(result.current.session.thinkingEffort).toBe('low')
  })

  it('user can still send when capabilities fail to load, then the default is used', async () => {
    const { api, result } = renderWorkspaceState((api) => {
      api.getCapabilities = async () => {
        throw new Error('offline')
      }
    })

    await waitFor(() => expect(result.current.session.reasoningCapabilities).toBeNull())

    act(() => void result.current.responses.sendMessage({ text: 'Hello', documents: [] }))
    await waitFor(() => expect(api.startedRequests[0]?.thinkingEffort).toBe('default'))
  })

  it('user starts a new session when no chat is selected, then the message uses it', async () => {
    const { api, result } = renderWorkspaceState()

    act(() => void result.current.responses.sendMessage({ text: 'Hello', documents: [] }))

    await waitFor(() => expect(api.startedRequests).toHaveLength(1))
    expect(api.createSession).toHaveBeenCalledOnce()
    expect(api.createSession).toHaveBeenCalledWith({ title: 'New chat' })
    expect(api.startedRequests[0]?.sessionId).toBe('session-new')
  })

  it('user binds a pending project when sending the first message, then it activates', async () => {
    const { api, result } = renderWorkspaceState((api) => {
      api.workspaceProjects = [
        {
          id: 'project-default',
          name: 'Default workspace',
          rootPath: '/projects/default',
          isDefault: true
        }
      ]
    })

    await waitFor(() => expect(result.current.session.activeProject?.id).toBe('project-default'))

    await act(async () => result.current.session.addProjectToNewChat())
    expect(result.current.session.pendingProject).toMatchObject({
      id: 'project-1',
      name: 'Project one'
    })
    expect(result.current.session.projects).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'project-1' })])
    )

    act(() => void result.current.responses.sendMessage({ text: 'Hello', documents: [] }))

    await waitFor(() => expect(api.startedRequests).toHaveLength(1))
    expect(api.createSession).toHaveBeenCalledWith({ title: 'New chat', projectId: 'project-1' })
    expect(result.current.session.pendingProject).toMatchObject({ id: 'project-default' })
    expect(result.current.session.activeProject).toMatchObject({
      id: 'project-1',
      name: 'Project one',
      rootPath: '/projects/one'
    })
  })

  it('user sees its workspace restored when reopening a chat, then the project matches', async () => {
    const { result } = renderWorkspaceState((api) => {
      api.sessions.load = async () => ({
        id: 'session-1',
        title: 'Saved chat',
        projectId: 'project-1',
        cwd: '/projects/one',
        defaultProfile: null,
        createdAt: 1,
        updatedAt: 2,
        lastActivityAt: 2,
        messages: []
      })
    })

    act(() => result.current.session.selectConversation('session-1'))

    await waitFor(() =>
      expect(result.current.session.activeProject).toMatchObject({
        id: 'project-1',
        name: 'one',
        rootPath: '/projects/one'
      })
    )
  })

  it('user sees independent responses when starting a new chat, then each ends alone', async () => {
    const sessionIds = ['session-one', 'session-two']
    const { api, result } = renderWorkspaceState((api) => {
      api.createSession.mockImplementation(async () => ({
        id: sessionIds.shift() ?? 'unexpected-session',
        title: 'New chat',
        defaultProfile: null,
        createdAt: 1,
        updatedAt: 1,
        lastActivityAt: 1
      }))
    })

    act(() => void result.current.responses.sendMessage({ text: 'First message', documents: [] }))
    await waitFor(() =>
      expect(result.current.responses.respondingConversationIds).toEqual(new Set(['session-one']))
    )

    act(() => result.current.session.startNewChat())
    act(() => void result.current.responses.sendMessage({ text: 'Second message', documents: [] }))

    await waitFor(() =>
      expect(result.current.responses.respondingConversationIds).toEqual(
        new Set(['session-one', 'session-two'])
      )
    )

    api.emit({ type: 'finish', requestId: api.startedRequests[0].requestId })

    await waitFor(() =>
      expect(result.current.responses.respondingConversationIds).toEqual(new Set(['session-two']))
    )
  })

  it('user sees a stable sidebar when streaming starts, then no extra work runs per stream tick', async () => {
    const { api, result } = renderWorkspaceState()

    act(() => void result.current.responses.sendMessage({ text: 'Hello', documents: [] }))
    await waitFor(() => expect(api.startedRequests).toHaveLength(1))
    const respondingConversationIds = result.current.responses.respondingConversationIds

    act(() => {
      api.emit({
        type: 'chunk',
        requestId: api.startedRequests[0].requestId,
        chunk: { type: 'text-start', id: 'part-1' }
      })
    })

    await waitFor(() => expect(result.current.responses.response.status).toBe('streaming'))
    expect(result.current.responses.respondingConversationIds).toBe(respondingConversationIds)
  })

  it('user sees rapid text batched when updates outpace the throttle, then it commits', async () => {
    vi.useFakeTimers()
    const { api, result } = renderWorkspaceState()

    act(() => void result.current.responses.sendMessage({ text: 'Hello', documents: [] }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const initialRequestId = api.startedRequests[0]?.requestId
    if (!initialRequestId) throw new Error('Sending a message must start a request.')
    const activeChat = result.current.session.activeChat
    if (!activeChat) throw new Error('Sending a message must create an active chat.')
    act(() => api.emit({ type: 'finish', requestId: initialRequestId }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const { result: transcript } = renderHook(() => useChat({ chat: activeChat, throttle: 50 }))
    act(() => void result.current.responses.sendMessage({ text: 'Hello again', documents: [] }))
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

  it('user sees a provider error scoped to its chat, then it clears when resending', async () => {
    const { api, result } = renderWorkspaceState()

    act(() => void result.current.responses.sendMessage({ text: 'First message', documents: [] }))
    await waitFor(() => expect(api.startedRequests).toHaveLength(1))

    const conversationId = result.current.session.activeConversation?.id
    if (!conversationId) throw new Error('Sending a message must create an active conversation.')
    api.emit({
      type: 'error',
      requestId: api.startedRequests[0].requestId,
      message: 'The chat provider could not complete the response.'
    })

    await waitFor(() =>
      expect(result.current.responses.response).toEqual({
        status: 'error',
        conversationId,
        message: 'The chat provider could not complete the response.'
      })
    )

    act(() => void result.current.responses.sendMessage({ text: 'Second message', documents: [] }))
    await waitFor(() => expect(api.startedRequests).toHaveLength(2))
    expect(result.current.responses.response).toMatchObject({ conversationId })
    expect(result.current.responses.response.status).not.toBe('error')
  })

  it('user sees the model selection return when reopening a chat, then effort returns', async () => {
    const savedProfile = {
      modelEntryId: 'ollama:qwen3',
      providerId: 'ollama',
      modelId: 'qwen3:8b',
      thinkingEffort: 'high' as const,
      configurationDigest: 'saved-configuration'
    }
    const { result } = renderWorkspaceState((api) => {
      api.sessions.list = async () => [
        {
          id: 'session-1',
          title: 'Saved chat',
          defaultProfile: savedProfile,
          createdAt: 1,
          updatedAt: 2,
          lastActivityAt: 2
        }
      ]
      api.sessions.load = async () => ({
        id: 'session-1',
        title: 'Saved chat',
        defaultProfile: savedProfile,
        createdAt: 1,
        updatedAt: 2,
        lastActivityAt: 2,
        messages: []
      })
    })

    await waitFor(() => expect(result.current.conversations).toHaveLength(1))
    act(() => result.current.session.selectConversation('session-1'))
    await waitFor(() => expect(result.current.session.selectedModelEntryId).toBe('ollama:qwen3'))

    act(() => result.current.session.startNewChat())
    act(() => result.current.session.selectConversation('session-1'))

    expect(result.current.session.selectedModelEntryId).toBe('ollama:qwen3')
    expect(result.current.session.thinkingEffort).toBe('high')
  })

  it('user sees the title update when a title is generated, then it appears', async () => {
    const { api, result } = renderWorkspaceState((api) => {
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
    })

    await waitFor(() => expect(result.current.conversations).toHaveLength(1))
    act(() => {
      api.emitTitleUpdated({ sessionId: 'session-1', title: 'Plan release notes' })
    })

    await waitFor(() =>
      expect(result.current.conversations).toMatchObject([
        { id: 'session-1', title: 'Plan release notes' }
      ])
    )
  })
})
