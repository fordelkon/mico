import type { Chat } from '@ai-sdk/react'
import * as React from 'react'

import type { Conversation, MicoUIMessage } from '@renderer/types/chat'
import type { ModelReasoningCapabilities, ThinkingSelection } from '@shared/data/schemas/chat'
import type { WorkspaceProject } from '@shared/data/schemas/workspace'
import type { PermissionMode } from '@shared/ai/permissions'

import type { ChatSessionsStore, ChatSession } from './chat-session-instances'

class ThinkingEffortStore {
  #value: ThinkingSelection = 'default'

  get(): ThinkingSelection {
    return this.#value
  }

  set(value: ThinkingSelection): void {
    this.#value = value
  }
}

type ActiveChatSession = {
  conversationId: string
  chat: Chat<MicoUIMessage>
  project: WorkspaceProject | null
}

/** The active conversation and every selection knob that rides on it. */
type ChatActiveSessionSlice = {
  /** The conversation record of the active session, looked up from the workspace list. */
  activeConversation: Conversation | null
  activeSession: ActiveChatSession | null
  activeChat: Chat<MicoUIMessage> | null
  permissionMode: PermissionMode
  setPermissionMode: (mode: PermissionMode) => void
  thinkingEffort: ThinkingSelection
  setThinkingEffort: (thinkingEffort: ThinkingSelection) => void
  reasoningCapabilities: ModelReasoningCapabilities | null
  selectedModelEntryId: string | null
  setSessionModelEntry: (modelEntryId: string) => Promise<void>
  projects: WorkspaceProject[]
  pendingProject: WorkspaceProject | null
  activeProject: WorkspaceProject | null
  composerFocusKey: number
  refreshProjects: () => Promise<void>
  addProjectToNewChat: () => Promise<void>
  selectProjectForNewChat: (project: WorkspaceProject) => void
  startNewChat: () => void
  selectConversation: (conversationId: string, options?: { focusComposer?: boolean }) => void
  /** Activates a freshly created session as the workspace's active chat. */
  activateNewSession: (conversation: Conversation, project: WorkspaceProject | null) => ChatSession
  /** Clears the active session when its conversation is deleted. */
  closeSessionIfActive: (conversationId: string) => void
}

function resolvePendingProject(
  projects: WorkspaceProject[],
  selectedProjectId: string | null
): WorkspaceProject | null {
  return selectedProjectId
    ? (projects.find(({ id }) => id === selectedProjectId) ?? null)
    : (projects.find(({ isDefault }) => isDefault) ?? null)
}

function useActiveSession(options: {
  sessions: ChatSessionsStore
  thinkingEffortStore: ThinkingEffortStore
}): Omit<ChatActiveSessionSlice, 'activeConversation'> {
  const { sessions, thinkingEffortStore } = options
  const [activeSession, setActiveSession] = React.useState<ActiveChatSession | null>(null)
  const [permissionMode, setPermissionModeState] = React.useState<PermissionMode>('default')
  const [reasoningCapabilities, setReasoningCapabilities] =
    React.useState<ModelReasoningCapabilities | null>(null)
  const [thinkingEffort, setThinkingEffortState] = React.useState<ThinkingSelection>('default')
  const [selectedModelEntryId, setSelectedModelEntryId] = React.useState<string | null>(null)
  const [selectedProjectId, setSelectedProjectId] = React.useState<string | null>(null)
  const [projects, setProjects] = React.useState<WorkspaceProject[]>([])
  const [composerFocusKey, setComposerFocusKey] = React.useState(1)

  const focusComposer = React.useCallback((): void => {
    // A new token requests focus without coupling the workspace to the textarea ref.
    setComposerFocusKey((key) => key + 1)
  }, [])

  const refreshProjects = React.useCallback(async (): Promise<void> => {
    const loadedProjects = await window.api.workspaces.list()
    setProjects(loadedProjects)
  }, [])

  React.useEffect(() => {
    void window.api.workspaces.list().then(setProjects, () => undefined)
  }, [])

  const setSessionModelEntry = React.useCallback(
    async (modelEntryId: string): Promise<void> => {
      if (!activeSession) return
      await window.api.sessions.setModelEntry({
        sessionId: activeSession.conversationId,
        modelEntryId
      })
      sessions.updateSession(activeSession.conversationId, (instance) => {
        instance.modelEntryId = modelEntryId
      })
      setSelectedModelEntryId(modelEntryId)
    },
    [activeSession, sessions]
  )

  const setPermissionMode = React.useCallback(
    (mode: PermissionMode): void => {
      setPermissionModeState(mode)
      if (activeSession)
        sessions.updateSession(activeSession.conversationId, (instance) => {
          instance.permissionMode = mode
        })
    },
    [activeSession, sessions]
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

  const setThinkingEffort = React.useCallback(
    (next: ThinkingSelection): void => {
      thinkingEffortStore.set(next)
      setThinkingEffortState(next)
      if (activeSession) {
        sessions.updateSession(activeSession.conversationId, (instance) => {
          instance.thinkingEffort = next
        })
        void window.api.sessions
          .setThinkingEffort({ sessionId: activeSession.conversationId, thinkingEffort: next })
          .catch(() => undefined)
      }
    },
    [activeSession, sessions, thinkingEffortStore]
  )

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

  const startNewChat = React.useCallback((): void => {
    setPermissionModeState('default')
    setActiveSession(null)
    setSelectedModelEntryId(null)
    setSelectedProjectId(null)
    focusComposer()
  }, [focusComposer])

  const selectConversation = React.useCallback(
    (
      conversationId: string,
      { focusComposer: focus = true }: { focusComposer?: boolean } = {}
    ): void => {
      const existing = sessions.getSession(conversationId)
      if (existing) {
        setPermissionModeState(existing.permissionMode)
        setActiveSession({ conversationId, chat: existing.chat, project: existing.project })
        setSelectedModelEntryId(existing.modelEntryId)
        if (existing.thinkingEffort) {
          thinkingEffortStore.set(existing.thinkingEffort)
          setThinkingEffortState(existing.thinkingEffort)
        }
        if (focus) focusComposer()
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
        const loadedProjects = await window.api.workspaces.list().catch(() => [])
        const project = persisted.projectId
          ? (loadedProjects.find(({ id }) => id === persisted.projectId) ??
            (persisted.cwd
              ? {
                  id: persisted.projectId,
                  name: persisted.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Workspace',
                  rootPath: persisted.cwd,
                  isDefault: false
                }
              : null))
          : null
        const instance = sessions.createSession(
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
          chat: instance.chat,
          project: instance.project
        })
        if (focus) focusComposer()
      })
    },
    [focusComposer, sessions, thinkingEffortStore]
  )

  const activateNewSession = React.useCallback(
    (conversation: Conversation, project: WorkspaceProject | null): ChatSession => {
      const instance = sessions.createSession(conversation, [], undefined, project)
      instance.permissionMode = permissionMode
      setActiveSession({
        conversationId: conversation.id,
        chat: instance.chat,
        project: instance.project
      })
      setSelectedProjectId(null)
      return instance
    },
    [permissionMode, sessions]
  )

  const closeSessionIfActive = React.useCallback((conversationId: string): void => {
    setActiveSession((current) => (current?.conversationId === conversationId ? null : current))
  }, [])

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

  return React.useMemo(
    () => ({
      activeSession,
      activeChat: activeSession?.chat ?? null,
      permissionMode,
      setPermissionMode,
      thinkingEffort,
      setThinkingEffort,
      reasoningCapabilities,
      selectedModelEntryId,
      setSessionModelEntry,
      projects,
      pendingProject,
      activeProject,
      composerFocusKey,
      refreshProjects,
      addProjectToNewChat,
      selectProjectForNewChat,
      startNewChat,
      selectConversation,
      activateNewSession,
      closeSessionIfActive
    }),
    [
      activeSession,
      permissionMode,
      setPermissionMode,
      thinkingEffort,
      setThinkingEffort,
      reasoningCapabilities,
      selectedModelEntryId,
      setSessionModelEntry,
      projects,
      pendingProject,
      activeProject,
      composerFocusKey,
      refreshProjects,
      addProjectToNewChat,
      selectProjectForNewChat,
      startNewChat,
      selectConversation,
      activateNewSession,
      closeSessionIfActive
    ]
  )
}

export {
  ThinkingEffortStore,
  useActiveSession,
  type ActiveChatSession,
  type ChatActiveSessionSlice
}
