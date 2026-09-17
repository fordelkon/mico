import { Chat } from '@ai-sdk/react'
import * as React from 'react'

import {
  IDLE_CHAT_RESPONSE,
  type ChatResponseState,
  type Conversation,
  type MicoUIMessage
} from '@renderer/types/chat'
import { ElectronChatTransport } from '@renderer/services/ai-transport/electron-chat-transport'
import type {
  ChatMessage,
  ModelReasoningCapabilities,
  ThinkingSelection
} from '@shared/data/schemas/chat'
import type { WorkspaceProject } from '@shared/data/schemas/workspace'

class ThinkingEffortStore {
  #value: ThinkingSelection = 'default'

  get(): ThinkingSelection {
    return this.#value
  }

  set(value: ThinkingSelection): void {
    this.#value = value
  }
}

type ChatWorkspace = {
  conversations: Conversation[]
  activeConversation: Conversation | null
  activeChat: Chat<MicoUIMessage> | null
  response: ChatResponseState
  respondingConversationIds: ReadonlySet<string>
  reasoningCapabilities: ModelReasoningCapabilities | null
  thinkingEffort: ThinkingSelection
  selectedModelEntryId: string | null
  pendingProject: WorkspaceProject | null
  addProjectToNewChat: () => Promise<void>
  setSessionModelEntry: (modelEntryId: string) => Promise<void>
  setThinkingEffort: (thinkingEffort: ThinkingSelection) => void
  composerFocusKey: number
  startNewChat: () => void
  selectConversation: (conversationId: string, options?: { focusComposer?: boolean }) => void
  renameConversation: (conversationId: string, title: string) => void
  deleteConversation: (conversationId: string) => void
  sendMessage: (content: string) => void
  retryResponse: () => void
  stopResponse: () => void
}

type ChatSession = {
  conversation: Conversation
  chat: Chat<MicoUIMessage>
  modelEntryId: string | null
  thinkingEffort: ThinkingSelection | null
}

type ActiveChatSession = {
  conversationId: string
  chat: Chat<MicoUIMessage>
}
type PendingMessage = { content: string; session: ChatSession }
type ActiveChatResponse = Exclude<ChatResponseState, { status: 'idle' }>

function toUiMessages(messages: ChatMessage[]): MicoUIMessage[] {
  return messages.map((message) => ({
    id: crypto.randomUUID(),
    role: message.role,
    metadata: message.metadata,
    parts: message.parts.flatMap((part) =>
      part.type === 'text' ? [{ type: 'text', text: part.text, state: 'done' as const }] : []
    )
  }))
}

function isResponding(response: ActiveChatResponse): boolean {
  return (
    response.status === 'submitted' ||
    response.status === 'streaming' ||
    response.status === 'retrying'
  )
}

function useChatWorkspaceState(): ChatWorkspace {
  // Keep sessions alive across selection changes so background responses can continue.
  const sessionsRef = React.useRef(new Map<string, ChatSession>())
  const [conversations, setConversations] = React.useState<Conversation[]>([])
  const [activeSession, setActiveSession] = React.useState<ActiveChatSession | null>(null)
  const [responses, setResponses] = React.useState<Map<string, ActiveChatResponse>>(() => new Map())
  const [respondingConversationIds, setRespondingConversationIds] = React.useState<
    ReadonlySet<string>
  >(() => new Set())
  const [pendingMessage, setPendingMessage] = React.useState<PendingMessage | null>(null)
  const [reasoningCapabilities, setReasoningCapabilities] =
    React.useState<ModelReasoningCapabilities | null>(null)
  const [thinkingEffort, setThinkingEffortState] = React.useState<ThinkingSelection>('default')
  const [selectedModelEntryId, setSelectedModelEntryId] = React.useState<string | null>(null)
  const [pendingProject, setPendingProject] = React.useState<WorkspaceProject | null>(null)
  const [thinkingEffortStore] = React.useState(() => new ThinkingEffortStore())
  const getThinkingEffort = React.useCallback(
    () => thinkingEffortStore.get(),
    [thinkingEffortStore]
  )
  // Response actions can run before React commits, so they need the latest synchronous values.
  const responseRef = React.useRef<Map<string, ActiveChatResponse>>(new Map())
  const isCreatingSessionRef = React.useRef(false)
  const [composerFocusKey, setComposerFocusKey] = React.useState(1)
  const setThinkingEffort = React.useCallback(
    (next: ThinkingSelection): void => {
      thinkingEffortStore.set(next)
      setThinkingEffortState(next)
      if (activeSession) {
        const session = sessionsRef.current.get(activeSession.conversationId)
        if (session) session.thinkingEffort = next
      }
      if (activeSession)
        void window.api.sessions
          .setThinkingEffort({ sessionId: activeSession.conversationId, thinkingEffort: next })
          .catch(() => undefined)
    },
    [activeSession, thinkingEffortStore]
  )

  React.useEffect(() => {
    let active = true

    void window.api.chat.getCapabilities().then(
      (capabilities) => {
        if (!active) return

        if (!capabilities) {
          setReasoningCapabilities(null)
          thinkingEffortStore.set('none')
          setThinkingEffortState('none')
          return
        }

        setReasoningCapabilities(capabilities)
        if (
          thinkingEffortStore.get() === 'default' ||
          !capabilities.selectableEfforts.includes(thinkingEffortStore.get())
        ) {
          thinkingEffortStore.set(capabilities.defaultEffort)
          setThinkingEffortState(capabilities.defaultEffort)
        }
      },
      () => {
        if (active) setReasoningCapabilities(null)
      }
    )

    return () => {
      active = false
    }
  }, [thinkingEffortStore])

  React.useEffect(() => {
    let active = true

    void window.api.sessions.list().then(
      (sessions) => {
        if (!active) return

        setConversations((current) =>
          current.length ? current : sessions.map(({ id, title }) => ({ id, title }))
        )
      },
      () => {
        if (active) setConversations([])
      }
    )

    return () => {
      active = false
    }
  }, [])

  React.useEffect(
    () =>
      window.api.sessions.onTitleUpdated(({ sessionId, title }) => {
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === sessionId ? { ...conversation, title } : conversation
          )
        )

        const session = sessionsRef.current.get(sessionId)
        if (session) session.conversation = { ...session.conversation, title }
      }),
    []
  )

  const setResponseState = React.useCallback((next: ActiveChatResponse): void => {
    responseRef.current.set(next.conversationId, next)
    setResponses(new Map(responseRef.current))
    setRespondingConversationIds((current) => {
      const currentlyResponding = current.has(next.conversationId)
      const nextResponding = isResponding(next)
      if (currentlyResponding === nextResponding) return current

      const updated = new Set(current)
      if (nextResponding) updated.add(next.conversationId)
      else updated.delete(next.conversationId)
      return updated
    })
  }, [])

  const settleResponse = React.useCallback((conversationId: string): void => {
    if (!responseRef.current.delete(conversationId)) return
    setResponses(new Map(responseRef.current))
    setRespondingConversationIds((current) => {
      if (!current.has(conversationId)) return current

      const updated = new Set(current)
      updated.delete(conversationId)
      return updated
    })
  }, [])

  const createSession = React.useCallback(
    (
      conversation: Conversation,
      messages: ChatMessage[] = [],
      selection: Pick<ChatSession, 'modelEntryId' | 'thinkingEffort'> = {
        modelEntryId: null,
        thinkingEffort: null
      }
    ): ChatSession => {
      const chat = new Chat<MicoUIMessage>({
        id: conversation.id,
        messages: toUiMessages(messages),
        transport: new ElectronChatTransport(window.api.chat, {
          sessionId: conversation.id,
          getThinkingEffort,
          onStatusChange: (status) => {
            const currentResponse = responseRef.current.get(conversation.id)
            if (!currentResponse || currentResponse.status === 'error') return

            if (status.type === 'retrying') {
              setResponseState({
                status: 'retrying',
                conversationId: conversation.id,
                ...status,
                startedAt: Date.now()
              })
            } else if (
              currentResponse.status === 'submitted' ||
              currentResponse.status === 'retrying'
            ) {
              setResponseState({ status: 'streaming', conversationId: conversation.id })
            }
          }
        }),
        onFinish: ({ isError }) => {
          if (!isError) settleResponse(conversation.id)
        },
        onError: (error) =>
          setResponseState({
            status: 'error',
            conversationId: conversation.id,
            message: error.message
          })
      })

      const session = { conversation, chat, ...selection }
      sessionsRef.current.set(conversation.id, session)
      return session
    },
    [getThinkingEffort, setResponseState, settleResponse]
  )

  React.useEffect(() => {
    if (!pendingMessage) return

    void pendingMessage.session.chat.sendMessage({ text: pendingMessage.content })
  }, [pendingMessage])

  const startNewChat = React.useCallback((): void => {
    setActiveSession(null)
    setSelectedModelEntryId(null)
    setPendingProject(null)
    // A new token requests focus without coupling the workspace to the textarea ref.
    setComposerFocusKey((key) => key + 1)
  }, [])

  const addProjectToNewChat = React.useCallback(async (): Promise<void> => {
    if (activeSession) return
    const project = await window.api.workspaces.addFromDialog()
    if (project) setPendingProject(project)
  }, [activeSession])

  const selectConversation = React.useCallback(
    (conversationId: string, { focusComposer = true }: { focusComposer?: boolean } = {}): void => {
      const existing = sessionsRef.current.get(conversationId)
      if (existing) {
        setActiveSession({ conversationId, chat: existing.chat })
        setSelectedModelEntryId(existing.modelEntryId)
        if (existing.thinkingEffort) {
          thinkingEffortStore.set(existing.thinkingEffort)
          setThinkingEffortState(existing.thinkingEffort)
        }
        if (focusComposer) setComposerFocusKey((key) => key + 1)
        return
      }

      void window.api.sessions.load(conversationId).then((persisted) => {
        const savedThinkingEffort = persisted.defaultProfile?.thinkingEffort
        setSelectedModelEntryId(persisted.defaultProfile?.modelEntryId ?? null)
        if (savedThinkingEffort) {
          thinkingEffortStore.set(savedThinkingEffort)
          setThinkingEffortState(savedThinkingEffort)
        }
        const session = createSession(
          { id: persisted.id, title: persisted.title },
          persisted.messages,
          {
            modelEntryId: persisted.defaultProfile?.modelEntryId ?? null,
            thinkingEffort: persisted.defaultProfile?.thinkingEffort ?? null
          }
        )
        setActiveSession({ conversationId: persisted.id, chat: session.chat })
        if (focusComposer) setComposerFocusKey((key) => key + 1)
      })
    },
    [createSession, thinkingEffortStore]
  )

  const renameConversation = React.useCallback((conversationId: string, title: string): void => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return

    void window.api.sessions
      .rename({ sessionId: conversationId, title: trimmedTitle })
      .then((summary) => {
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === conversationId
              ? { ...conversation, title: summary.title }
              : conversation
          )
        )

        const session = sessionsRef.current.get(conversationId)
        if (session) session.conversation = { ...session.conversation, title: summary.title }
      })
      .catch(() => undefined)
  }, [])

  const setSessionModelEntry = React.useCallback(
    async (modelEntryId: string): Promise<void> => {
      if (!activeSession) return
      await window.api.sessions.setModelEntry({
        sessionId: activeSession.conversationId,
        modelEntryId
      })
      const session = sessionsRef.current.get(activeSession.conversationId)
      if (session) session.modelEntryId = modelEntryId
      setSelectedModelEntryId(modelEntryId)
    },
    [activeSession]
  )

  const deleteConversation = React.useCallback(
    (conversationId: string): void => {
      const session = sessionsRef.current.get(conversationId)
      const deletePersistedSession = async (): Promise<void> => {
        const currentResponse = responseRef.current.get(conversationId)
        if (session && currentResponse) {
          await session.chat.stop()
          settleResponse(conversationId)
        }
        await window.api.sessions.delete(conversationId)
        sessionsRef.current.delete(conversationId)
        setConversations((current) =>
          current.filter((conversation) => conversation.id !== conversationId)
        )
        setActiveSession((current) => (current?.conversationId === conversationId ? null : current))
      }

      void deletePersistedSession()
    },
    [settleResponse]
  )

  const sendMessage = React.useCallback(
    (content: string): void => {
      if (!content.trim()) return

      const existingSession = activeSession
        ? sessionsRef.current.get(activeSession.conversationId)
        : undefined
      const currentResponse = existingSession
        ? responseRef.current.get(existingSession.conversation.id)
        : undefined

      if (
        currentResponse?.status === 'submitted' ||
        currentResponse?.status === 'streaming' ||
        currentResponse?.status === 'retrying'
      ) {
        return
      }

      if (existingSession) {
        setResponseState({ status: 'submitted', conversationId: existingSession.conversation.id })
        void existingSession.chat.sendMessage({ text: content })
        return
      }

      if (isCreatingSessionRef.current) return

      isCreatingSessionRef.current = true
      const createInput = pendingProject
        ? { title: 'New chat', projectId: pendingProject.id }
        : { title: 'New chat' }
      void window.api.sessions
        .create(createInput)
        .then((summary) => {
          const conversation = { id: summary.id, title: summary.title }
          const session = createSession(conversation)
          setConversations((current) => [...current, conversation])
          setActiveSession({ conversationId: conversation.id, chat: session.chat })
          setPendingProject(null)
          setResponseState({ status: 'submitted', conversationId: conversation.id })
          setPendingMessage({ content, session })
        })
        .finally(() => {
          isCreatingSessionRef.current = false
        })
    },
    [activeSession, createSession, pendingProject, setResponseState]
  )

  const stopResponse = React.useCallback((): void => {
    const currentResponse = activeSession
      ? responseRef.current.get(activeSession.conversationId)
      : undefined
    if (!currentResponse || currentResponse.conversationId !== activeSession?.conversationId) {
      return
    }

    const conversationId = currentResponse.conversationId
    const session = sessionsRef.current.get(conversationId)
    if (!session) {
      settleResponse(conversationId)
      return
    }

    void session.chat.stop().then(
      () => {
        session.chat.messages = session.chat.messages.map((message, index, messages) =>
          index === messages.length - 1 && message.role === 'assistant'
            ? {
                ...message,
                metadata: {
                  ...message.metadata,
                  completionState: 'stopped' as const
                }
              }
            : message
        )
        settleResponse(conversationId)
      },
      () => settleResponse(conversationId)
    )
  }, [activeSession, settleResponse])

  const retryResponse = React.useCallback((): void => {
    const currentResponse = activeSession
      ? responseRef.current.get(activeSession.conversationId)
      : undefined
    if (
      currentResponse?.status !== 'error' ||
      currentResponse.conversationId !== activeSession?.conversationId
    ) {
      return
    }

    const session = sessionsRef.current.get(currentResponse.conversationId)
    if (!session) return

    setResponseState({ status: 'submitted', conversationId: currentResponse.conversationId })
    void session.chat.regenerate()
  }, [activeSession, setResponseState])

  React.useEffect(
    () => () => {
      // Sessions may continue streaming after navigation; stop all of them when the workspace unmounts.
      for (const { chat } of sessionsRef.current.values()) {
        void chat.stop()
      }
    },
    []
  )

  const activeConversation = React.useMemo(
    () =>
      activeSession
        ? (conversations.find((conversation) => conversation.id === activeSession.conversationId) ??
          null)
        : null,
    [activeSession, conversations]
  )
  const activeChat = activeSession?.chat ?? null
  const response = activeSession
    ? (responses.get(activeSession.conversationId) ?? IDLE_CHAT_RESPONSE)
    : IDLE_CHAT_RESPONSE
  return React.useMemo(
    () => ({
      conversations,
      activeConversation,
      activeChat,
      response,
      respondingConversationIds,
      reasoningCapabilities,
      thinkingEffort,
      selectedModelEntryId,
      pendingProject,
      addProjectToNewChat,
      setSessionModelEntry,
      setThinkingEffort,
      composerFocusKey,
      startNewChat,
      selectConversation,
      renameConversation,
      deleteConversation,
      sendMessage,
      retryResponse,
      stopResponse
    }),
    [
      activeConversation,
      addProjectToNewChat,
      activeChat,
      composerFocusKey,
      conversations,
      deleteConversation,
      renameConversation,
      response,
      reasoningCapabilities,
      respondingConversationIds,
      retryResponse,
      selectConversation,
      sendMessage,
      setThinkingEffort,
      setSessionModelEntry,
      startNewChat,
      stopResponse,
      thinkingEffort,
      pendingProject,
      selectedModelEntryId
    ]
  )
}

export { useChatWorkspaceState, type ChatWorkspace }
