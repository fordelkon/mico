import * as React from 'react'

import type { Conversation } from '@renderer/types/chat'
import type { ModelReasoningCapabilities, ThinkingSelection } from '@shared/data/schemas/chat'
import type { WorkspaceProject } from '@shared/data/schemas/workspace'
import type { PermissionMode } from '@shared/ai/permissions'

import type { ChatSessionsStore, ConversationTranscriptSource } from './chat-session-instances'

type ActiveChatSession = {
  conversationId: string
  transcript: ConversationTranscriptSource
  project: WorkspaceProject | null
}

/** The active conversation and every selection knob that rides on it. */
type ChatActiveSessionSlice = {
  /** The conversation record of the active session, looked up from the workspace list. */
  activeConversation: Conversation | null
  activeSession: ActiveChatSession | null
  transcript: ConversationTranscriptSource | null
  permissionMode: PermissionMode
  setPermissionMode: (mode: PermissionMode) => void
  thinkingEffort: ThinkingSelection
  setThinkingEffort: (thinkingEffort: ThinkingSelection) => void
  reasoningCapabilities: ModelReasoningCapabilities | null
  refreshCapabilities: () => Promise<void>
  activationError: string | null
  selectedModelEntryId: string | null
  setSessionModelEntry: (modelEntryId: string) => Promise<void>
  projects: WorkspaceProject[]
  pendingProject: WorkspaceProject | null
  activeProject: WorkspaceProject | null
  composerFocusKey: number
  refreshProjects: () => Promise<void>
  addProjectToNewChat: () => Promise<void>
  selectProjectForNewChat: (project: WorkspaceProject) => void
  /** Leaves any active session behind and starts an empty draft, optionally bound to a project. */
  startNewChat: (project?: WorkspaceProject) => void
  selectConversation: (conversationId: string, options?: { focusComposer?: boolean }) => void
}

function resolvePendingProject(
  projects: WorkspaceProject[],
  selectedProjectId: string | null
): WorkspaceProject | null {
  return selectedProjectId
    ? (projects.find(({ id }) => id === selectedProjectId) ?? null)
    : (projects.find(({ isDefault }) => isDefault) ?? null)
}

function useActiveSession(options: { sessions: ChatSessionsStore }): Omit<
  ChatActiveSessionSlice,
  'activeConversation'
> & {
  createNewSession: () => Promise<Conversation>
  closeSessionIfActive: (conversationId: string) => void
} {
  const { sessions } = options
  const { setRequestConfig } = sessions
  const thinkingEffortRef = React.useRef<ThinkingSelection>('default')
  const activationRef = React.useRef<{ revision: number; conversationId: string | null }>({
    revision: 0,
    conversationId: null
  })
  const capabilitiesRevisionRef = React.useRef(0)
  const modelUpdatesRef = React.useRef(new Map<string, number>())
  const [activeSession, setActiveSession] = React.useState<ActiveChatSession | null>(null)
  const [permissionMode, setPermissionModeState] = React.useState<PermissionMode>('default')
  const [reasoningCapabilities, setReasoningCapabilities] =
    React.useState<ModelReasoningCapabilities | null>(null)
  const [thinkingEffort, setThinkingEffortState] = React.useState<ThinkingSelection>('default')
  const selectedModelEntryId = activeSession
    ? (sessions.getSession(activeSession.conversationId)?.requestConfig.modelEntryId ?? null)
    : null
  const [activationError, setActivationError] = React.useState<string | null>(null)
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
      const activation = activationRef.current
      const revision = (modelUpdatesRef.current.get(activeSession.conversationId) ?? 0) + 1
      modelUpdatesRef.current.set(activeSession.conversationId, revision)
      await window.api.sessions.setModelEntry({
        sessionId: activeSession.conversationId,
        modelEntryId
      })
      if (modelUpdatesRef.current.get(activeSession.conversationId) !== revision) return
      sessions.setRequestConfig(activeSession.conversationId, { modelEntryId })
      setActiveSession((current) =>
        current?.conversationId === activeSession.conversationId ? { ...current } : current
      )
      if (activationRef.current === activation) setReasoningCapabilities(null)
    },
    [activeSession, sessions]
  )

  const setPermissionMode = React.useCallback(
    (mode: PermissionMode): void => {
      setPermissionModeState(mode)
      if (activeSession)
        sessions.setRequestConfig(activeSession.conversationId, { permissionMode: mode })
    },
    [activeSession, sessions]
  )

  const conversationId = activeSession?.conversationId
  const loadCapabilities = React.useCallback(
    async (adjustSelection: boolean): Promise<void> => {
      const activation = activationRef.current
      if (activation.conversationId !== (conversationId ?? null)) return
      const revision = ++capabilitiesRevisionRef.current
      const capabilities = await window.api.chat.getCapabilities(conversationId)
      if (capabilitiesRevisionRef.current !== revision || activationRef.current !== activation)
        return
      setReasoningCapabilities(capabilities)
      if (!adjustSelection) return
      const current = thinkingEffortRef.current
      const next = capabilities
        ? current === 'default' || !capabilities.selectableEfforts.includes(current)
          ? capabilities.defaultEffort
          : current
        : 'none'
      thinkingEffortRef.current = next
      setThinkingEffortState(next)
      if (conversationId) setRequestConfig(conversationId, { thinkingEffort: next })
    },
    [conversationId, setRequestConfig]
  )

  const refreshCapabilities = React.useCallback(
    (): Promise<void> => loadCapabilities(true),
    [loadCapabilities]
  )

  React.useEffect(() => {
    void loadCapabilities(!conversationId).catch(() => undefined)
    return () => {
      capabilitiesRevisionRef.current += 1
    }
  }, [conversationId, selectedModelEntryId, loadCapabilities])

  React.useEffect(
    () => () => {
      activationRef.current = { revision: activationRef.current.revision + 1, conversationId: null }
    },
    []
  )

  const setThinkingEffort = React.useCallback(
    (next: ThinkingSelection): void => {
      thinkingEffortRef.current = next
      setThinkingEffortState(next)
      if (activeSession) {
        sessions.setRequestConfig(activeSession.conversationId, { thinkingEffort: next })
        void window.api.sessions
          .setThinkingEffort({ sessionId: activeSession.conversationId, thinkingEffort: next })
          .catch(() => undefined)
      }
    },
    [activeSession, sessions]
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

  const startNewChat = React.useCallback(
    (project?: WorkspaceProject): void => {
      activationRef.current = { revision: activationRef.current.revision + 1, conversationId: null }
      setPermissionModeState('default')
      setActivationError(null)
      setReasoningCapabilities(null)
      setActiveSession(null)
      // A project navigation binds its workspace to the empty draft; the plain
      // new-chat action falls back to the default workspace on first send.
      setSelectedProjectId(project ? project.id : null)
      focusComposer()
    },
    [focusComposer]
  )

  const selectConversation = React.useCallback(
    (
      conversationId: string,
      { focusComposer: focus = true }: { focusComposer?: boolean } = {}
    ): void => {
      const activation = { revision: activationRef.current.revision + 1, conversationId }
      activationRef.current = activation
      setActivationError(null)
      setReasoningCapabilities(null)
      const existing = sessions.getSession(conversationId)
      if (existing) {
        sessions.refreshRecoveryIfStale(conversationId)
        setPermissionModeState(existing.requestConfig.permissionMode)
        setActiveSession({
          conversationId,
          transcript: existing.transcript,
          project: existing.project
        })
        thinkingEffortRef.current = existing.requestConfig.thinkingEffort ?? 'default'
        setThinkingEffortState(thinkingEffortRef.current)
        if (focus) focusComposer()
        return
      }

      void window.api.sessions
        .load(conversationId)
        .then(async (persisted) => {
          if (activationRef.current !== activation) return
          const loadedProjects = await window.api.workspaces.list().catch(() => [])
          if (activationRef.current !== activation) return
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
              thinkingEffort: persisted.defaultProfile?.thinkingEffort ?? null,
              permissionMode: 'default'
            },
            project,
            persisted.recovery
          )
          setPermissionModeState(instance.requestConfig.permissionMode)
          thinkingEffortRef.current = instance.requestConfig.thinkingEffort ?? 'default'
          setThinkingEffortState(thinkingEffortRef.current)
          setActiveSession({
            conversationId: persisted.id,
            transcript: instance.transcript,
            project: instance.project
          })
          if (focus) focusComposer()
        })
        .catch(() => {
          if (activationRef.current === activation)
            setActivationError('Could not open this conversation. Select it again to retry.')
        })
    },
    [focusComposer, sessions]
  )

  const createNewSession = React.useCallback(async (): Promise<Conversation> => {
    const activation = activationRef.current
    const project = resolvePendingProject(projects, selectedProjectId)
    const thinkingEffort = thinkingEffortRef.current
    const summary = await window.api.sessions.create(
      project ? { title: 'New chat', projectId: project.id } : { title: 'New chat' }
    )
    const conversation = {
      id: summary.id,
      title: summary.title,
      projectId: summary.projectId,
      cwd: summary.cwd,
      lastActivityAt: summary.lastActivityAt
    }
    const instance = sessions.createSession(
      conversation,
      [],
      {
        modelEntryId: null,
        thinkingEffort,
        permissionMode
      },
      project
    )
    if (activationRef.current !== activation) return conversation
    activationRef.current = { revision: activation.revision + 1, conversationId: conversation.id }
    setActivationError(null)
    setReasoningCapabilities(null)
    setActiveSession({
      conversationId: conversation.id,
      transcript: instance.transcript,
      project: instance.project
    })
    setSelectedProjectId(null)
    return conversation
  }, [permissionMode, projects, selectedProjectId, sessions])

  const closeSessionIfActive = React.useCallback((conversationId: string): void => {
    if (activationRef.current.conversationId === conversationId)
      activationRef.current = { revision: activationRef.current.revision + 1, conversationId: null }
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
      transcript: activeSession?.transcript ?? null,
      permissionMode,
      setPermissionMode,
      thinkingEffort,
      setThinkingEffort,
      reasoningCapabilities,
      refreshCapabilities,
      activationError,
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
      createNewSession,
      closeSessionIfActive
    }),
    [
      activeSession,
      permissionMode,
      setPermissionMode,
      thinkingEffort,
      setThinkingEffort,
      reasoningCapabilities,
      refreshCapabilities,
      activationError,
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
      createNewSession,
      closeSessionIfActive
    ]
  )
}

export { useActiveSession, type ActiveChatSession, type ChatActiveSessionSlice }
