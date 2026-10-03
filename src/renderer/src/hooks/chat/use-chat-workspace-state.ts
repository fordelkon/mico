import type { Chat } from '@ai-sdk/react'
import * as React from 'react'

import {
  IDLE_CHAT_RESPONSE,
  isActiveChatResponse,
  type ChatResponseState,
  type Conversation,
  type MicoUIMessage
} from '@renderer/types/chat'
import type {
  ChatDocumentPart,
  ModelReasoningCapabilities,
  ThinkingSelection
} from '@shared/data/schemas/chat'
import type { WorkspaceProject } from '@shared/data/schemas/workspace'
import type { PermissionMode } from '@shared/ai/permissions'

import { useChatResponses } from './chat-response-store'
import { useChatSessions, type ChatSession } from './chat-session-instances'

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
  permissionMode: PermissionMode
  setPermissionMode: (mode: PermissionMode) => void
  conversations: Conversation[]
  activeConversation: Conversation | null
  activeChat: Chat<MicoUIMessage> | null
  response: ChatResponseState
  respondingConversationIds: ReadonlySet<string>
  reasoningCapabilities: ModelReasoningCapabilities | null
  thinkingEffort: ThinkingSelection
  selectedModelEntryId: string | null
  pendingProject: WorkspaceProject | null
  activeProject: WorkspaceProject | null
  projects: WorkspaceProject[]
  refreshProjects: () => Promise<void>
  addProjectToNewChat: () => Promise<void>
  selectProjectForNewChat: (project: WorkspaceProject) => void
  setSessionModelEntry: (modelEntryId: string) => Promise<void>
  setThinkingEffort: (thinkingEffort: ThinkingSelection) => void
  composerFocusKey: number
  startNewChat: () => void
  selectConversation: (conversationId: string, options?: { focusComposer?: boolean }) => void
  renameConversation: (conversationId: string, title: string) => void
  deleteConversation: (conversationId: string) => void
  sendMessage: (content: ChatSendInput) => Promise<boolean>
  retryResponse: () => void
  stopResponse: () => void
}

type ActiveChatSession = {
  conversationId: string
  chat: Chat<MicoUIMessage>
  project: WorkspaceProject | null
}
type ChatSendInput = { text: string; documents: ChatDocumentPart[] }
type PendingMessage = { parts: MicoUIMessage['parts']; session: ChatSession }

function resolvePendingProject(
  projects: WorkspaceProject[],
  selectedProjectId: string | null
): WorkspaceProject | null {
  return selectedProjectId
    ? (projects.find(({ id }) => id === selectedProjectId) ?? null)
    : (projects.find(({ isDefault }) => isDefault) ?? null)
}

function useChatWorkspaceState(): ChatWorkspace {
  const { responses, respondingConversationIds, getResponse, setResponseState, settleResponse } =
    useChatResponses()
  const [conversations, setConversations] = React.useState<Conversation[]>([])
  const [permissionMode, setPermissionModeState] = React.useState<PermissionMode>('default')
  const [activeSession, setActiveSession] = React.useState<ActiveChatSession | null>(null)
  const [pendingMessage, setPendingMessage] = React.useState<PendingMessage | null>(null)
  const [reasoningCapabilities, setReasoningCapabilities] =
    React.useState<ModelReasoningCapabilities | null>(null)
  const [thinkingEffort, setThinkingEffortState] = React.useState<ThinkingSelection>('default')
  const [selectedModelEntryId, setSelectedModelEntryId] = React.useState<string | null>(null)
  const [selectedProjectId, setSelectedProjectId] = React.useState<string | null>(null)
  const [projects, setProjects] = React.useState<WorkspaceProject[]>([])
  const [thinkingEffortStore] = React.useState(() => new ThinkingEffortStore())
  const getThinkingEffort = React.useCallback(
    () => thinkingEffortStore.get(),
    [thinkingEffortStore]
  )
  const isCreatingSessionRef = React.useRef(false)
  const [composerFocusKey, setComposerFocusKey] = React.useState(1)
  const { getSession, removeSession, createSession, updateSession } = useChatSessions({
    getThinkingEffort,
    getResponse,
    onResponseState: setResponseState,
    onResponseSettled: settleResponse
  })

  const refreshProjects = React.useCallback(async (): Promise<void> => {
    const loadedProjects = await window.api.workspaces.list()
    setProjects(loadedProjects)
  }, [])

  const setPermissionMode = React.useCallback(
    (mode: PermissionMode): void => {
      setPermissionModeState(mode)
      if (activeSession)
        updateSession(activeSession.conversationId, (session) => {
          session.permissionMode = mode
        })
    },
    [activeSession, updateSession]
  )

  React.useEffect(() => {
    void window.api.workspaces.list().then(setProjects, () => undefined)
  }, [])
  const setThinkingEffort = React.useCallback(
    (next: ThinkingSelection): void => {
      thinkingEffortStore.set(next)
      setThinkingEffortState(next)
      if (activeSession) {
        updateSession(activeSession.conversationId, (session) => {
          session.thinkingEffort = next
        })
        void window.api.sessions
          .setThinkingEffort({ sessionId: activeSession.conversationId, thinkingEffort: next })
          .catch(() => undefined)
      }
    },
    [activeSession, thinkingEffortStore, updateSession]
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
          current.length
            ? current
            : sessions.map(({ id, title, projectId, cwd, lastActivityAt }) => ({
                id,
                title,
                projectId,
                cwd,
                lastActivityAt
              }))
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

        updateSession(sessionId, (session) => {
          session.conversation = { ...session.conversation, title }
        })
      }),
    [updateSession]
  )

  React.useEffect(() => {
    if (!pendingMessage) return

    void pendingMessage.session.chat.sendMessage({ parts: pendingMessage.parts })
  }, [pendingMessage])

  const startNewChat = React.useCallback((): void => {
    setPermissionModeState('default')
    setActiveSession(null)
    setSelectedModelEntryId(null)
    setSelectedProjectId(null)
    // A new token requests focus without coupling the workspace to the textarea ref.
    setComposerFocusKey((key) => key + 1)
  }, [])

  const addProjectToNewChat = React.useCallback(async (): Promise<void> => {
    if (activeSession) return
    const project = await window.api.workspaces.addFromDialog()
    if (!project) return
    setSelectedProjectId(project.id)
    setProjects((current) => {
      const previous = current.find(({ id }) => id === project.id)
      return previous
        ? current.map((candidate) => (candidate.id === project.id ? project : candidate))
        : [...current, project]
    })
  }, [activeSession])

  const selectProjectForNewChat = React.useCallback(
    (project: WorkspaceProject): void => {
      if (!activeSession) setSelectedProjectId(project.id)
    },
    [activeSession]
  )

  const selectConversation = React.useCallback(
    (conversationId: string, { focusComposer = true }: { focusComposer?: boolean } = {}): void => {
      const existing = getSession(conversationId)
      if (existing) {
        setPermissionModeState(existing.permissionMode)
        setActiveSession({ conversationId, chat: existing.chat, project: existing.project })
        setSelectedModelEntryId(existing.modelEntryId)
        if (existing.thinkingEffort) {
          thinkingEffortStore.set(existing.thinkingEffort)
          setThinkingEffortState(existing.thinkingEffort)
        }
        if (focusComposer) setComposerFocusKey((key) => key + 1)
        return
      }

      void window.api.sessions.load(conversationId).then(async (persisted) => {
        setPermissionModeState('default')
        const savedThinkingEffort = persisted.defaultProfile?.thinkingEffort
        setSelectedModelEntryId(persisted.defaultProfile?.modelEntryId ?? null)
        if (savedThinkingEffort) {
          thinkingEffortStore.set(savedThinkingEffort)
          setThinkingEffortState(savedThinkingEffort)
        }
        const projects = await window.api.workspaces.list().catch(() => [])
        const project = persisted.projectId
          ? (projects.find(({ id }) => id === persisted.projectId) ??
            (persisted.cwd
              ? {
                  id: persisted.projectId,
                  name: persisted.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Workspace',
                  rootPath: persisted.cwd,
                  isDefault: false
                }
              : null))
          : null
        const session = createSession(
          { id: persisted.id, title: persisted.title },
          persisted.messages,
          {
            modelEntryId: persisted.defaultProfile?.modelEntryId ?? null,
            thinkingEffort: persisted.defaultProfile?.thinkingEffort ?? null
          },
          project
        )
        setActiveSession({
          conversationId: persisted.id,
          chat: session.chat,
          project: session.project
        })
        if (focusComposer) setComposerFocusKey((key) => key + 1)
      })
    },
    [createSession, getSession, thinkingEffortStore]
  )

  const renameConversation = React.useCallback(
    (conversationId: string, title: string): void => {
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

          updateSession(conversationId, (session) => {
            session.conversation = { ...session.conversation, title: summary.title }
          })
        })
        .catch(() => undefined)
    },
    [updateSession]
  )

  const setSessionModelEntry = React.useCallback(
    async (modelEntryId: string): Promise<void> => {
      if (!activeSession) return
      await window.api.sessions.setModelEntry({
        sessionId: activeSession.conversationId,
        modelEntryId
      })
      updateSession(activeSession.conversationId, (session) => {
        session.modelEntryId = modelEntryId
      })
      setSelectedModelEntryId(modelEntryId)
    },
    [activeSession, updateSession]
  )

  const deleteConversation = React.useCallback(
    (conversationId: string): void => {
      const session = getSession(conversationId)
      const deletePersistedSession = async (): Promise<void> => {
        const currentResponse = getResponse(conversationId)
        if (session && currentResponse) {
          await session.chat.stop()
          settleResponse(conversationId)
        }
        await window.api.sessions.delete(conversationId)
        removeSession(conversationId)
        setConversations((current) =>
          current.filter((conversation) => conversation.id !== conversationId)
        )
        setActiveSession((current) => (current?.conversationId === conversationId ? null : current))
      }

      void deletePersistedSession()
    },
    [getResponse, getSession, removeSession, settleResponse]
  )

  const sendMessage = React.useCallback(
    async ({ text, documents }: ChatSendInput): Promise<boolean> => {
      if (!text.trim() && !documents.length) return false

      const existingSession = activeSession ? getSession(activeSession.conversationId) : undefined
      const currentResponse = existingSession
        ? getResponse(existingSession.conversation.id)
        : undefined

      if (currentResponse && isActiveChatResponse(currentResponse)) {
        return false
      }

      const parts: MicoUIMessage['parts'] = []
      if (text.trim()) parts.push({ type: 'text', text })
      for (const document of documents) parts.push({ type: 'data-document', data: document })

      if (existingSession) {
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === existingSession.conversation.id
              ? { ...conversation, lastActivityAt: Date.now() }
              : conversation
          )
        )
        setResponseState({ status: 'submitted', conversationId: existingSession.conversation.id })
        void existingSession.chat.sendMessage({ parts })
        return true
      }

      if (isCreatingSessionRef.current) return false

      isCreatingSessionRef.current = true
      const pendingProject = resolvePendingProject(projects, selectedProjectId)
      const createInput = pendingProject
        ? { title: 'New chat', projectId: pendingProject.id }
        : { title: 'New chat' }
      try {
        const summary = await window.api.sessions.create(createInput)
        const conversation = {
          id: summary.id,
          title: summary.title,
          projectId: summary.projectId,
          cwd: summary.cwd,
          lastActivityAt: summary.lastActivityAt
        }
        const session = createSession(conversation, [], undefined, pendingProject)
        session.permissionMode = permissionMode
        setConversations((current) => [...current, conversation])
        setActiveSession({
          conversationId: conversation.id,
          chat: session.chat,
          project: session.project
        })
        setSelectedProjectId(null)
        setResponseState({ status: 'submitted', conversationId: conversation.id })
        setPendingMessage({ parts, session })
        return true
      } finally {
        isCreatingSessionRef.current = false
      }
    },
    [
      activeSession,
      createSession,
      getSession,
      getResponse,
      projects,
      selectedProjectId,
      permissionMode,
      setResponseState
    ]
  )

  const stopResponse = React.useCallback((): void => {
    const currentResponse = activeSession ? getResponse(activeSession.conversationId) : undefined
    if (!currentResponse || currentResponse.conversationId !== activeSession?.conversationId) {
      return
    }

    const conversationId = currentResponse.conversationId
    const session = getSession(conversationId)
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
  }, [activeSession, getSession, getResponse, settleResponse])

  const retryResponse = React.useCallback((): void => {
    const currentResponse = activeSession ? getResponse(activeSession.conversationId) : undefined
    if (
      currentResponse?.status !== 'error' ||
      currentResponse.conversationId !== activeSession?.conversationId
    ) {
      return
    }

    const session = getSession(currentResponse.conversationId)
    if (!session) return

    setResponseState({ status: 'submitted', conversationId: currentResponse.conversationId })
    void session.chat.regenerate()
  }, [activeSession, getSession, getResponse, setResponseState])

  const activeConversation = React.useMemo(
    () =>
      activeSession
        ? (conversations.find((conversation) => conversation.id === activeSession.conversationId) ??
          null)
        : null,
    [activeSession, conversations]
  )
  const activeChat = activeSession?.chat ?? null
  const pendingProject = resolvePendingProject(projects, selectedProjectId)
  const activeProject = React.useMemo(() => {
    if (!activeSession) return pendingProject
    const boundProject = activeSession.project
    if (!boundProject) return null
    const registeredProject = projects.find(({ id }) => id === boundProject.id)
    // Display current catalog metadata without changing the conversation's bound folder.
    return registeredProject
      ? { ...boundProject, name: registeredProject.name, isDefault: registeredProject.isDefault }
      : boundProject
  }, [activeSession, pendingProject, projects])
  const response = activeSession
    ? (responses.get(activeSession.conversationId) ?? IDLE_CHAT_RESPONSE)
    : IDLE_CHAT_RESPONSE
  return React.useMemo(
    () => ({
      conversations,
      permissionMode,
      setPermissionMode,
      activeConversation,
      activeChat,
      response,
      respondingConversationIds,
      reasoningCapabilities,
      thinkingEffort,
      selectedModelEntryId,
      pendingProject,
      activeProject,
      projects,
      refreshProjects,
      addProjectToNewChat,
      selectProjectForNewChat,
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
      permissionMode,
      setPermissionMode,
      addProjectToNewChat,
      activeChat,
      activeProject,
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
      projects,
      refreshProjects,
      selectedModelEntryId,
      selectProjectForNewChat
    ]
  )
}

export { useChatWorkspaceState, type ChatWorkspace }
