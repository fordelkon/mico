import * as React from 'react'

import {
  IDLE_CHAT_RESPONSE,
  isActiveChatResponse,
  type ChatResponseState,
  type MicoUIMessage
} from '@renderer/types/chat'
import type { ChatDocumentPart } from '@shared/data/schemas/chat'

import { useChatResponses } from './chat-response-store'
import {
  ThinkingEffortStore,
  useActiveSession,
  type ChatActiveSessionSlice
} from './use-active-session'
import { useChatSessions, type ChatSession } from './chat-session-instances'
import { useConversationList } from './use-conversation-list'

type ChatSendInput = { text: string; documents: ChatDocumentPart[] }
type PendingMessage = { parts: MicoUIMessage['parts']; session: ChatSession }

/** Response control for the workspace: state, and the actions that drive it. */
type ChatResponseSlice = {
  response: ChatResponseState
  respondingConversationIds: ReadonlySet<string>
  sendMessage: (content: ChatSendInput) => Promise<boolean>
  retryResponse: () => void
  stopResponse: () => void
}

type ChatWorkspace = {
  conversations: ReturnType<typeof useConversationList>['conversations']
  renameConversation: (conversationId: string, title: string) => void
  deleteConversation: (conversationId: string) => void
  session: ChatActiveSessionSlice
  responses: ChatResponseSlice
}

/**
 * Composes the workspace's slices — conversation list, active session, response
 * control — and owns only the orchestration that spans them: sending a message
 * across session creation, stopping and retrying responses, deleting
 * conversations, and relaying generated titles.
 */
function useChatWorkspaceState(): ChatWorkspace {
  const { responses, respondingConversationIds, getResponse, setResponseState, settleResponse } =
    useChatResponses()
  const thinkingEffortStore = React.useState(() => new ThinkingEffortStore())[0]
  const sessions = useChatSessions({
    getThinkingEffort: React.useCallback(() => thinkingEffortStore.get(), [thinkingEffortStore]),
    getResponse,
    onResponseState: setResponseState,
    onResponseSettled: settleResponse
  })
  const conversationList = useConversationList()
  const {
    addConversation,
    applyConversationTitle,
    conversations,
    removeConversation,
    touchConversationActivity
  } = conversationList
  const { getSession, removeSession, updateSession } = sessions
  const activeSessionSlice = useActiveSession({ sessions, thinkingEffortStore })
  const { activeSession, activateNewSession, closeSessionIfActive, pendingProject } =
    activeSessionSlice
  const activeConversation = React.useMemo(
    () =>
      activeSession
        ? (conversations.find(({ id }) => id === activeSession.conversationId) ?? null)
        : null,
    [activeSession, conversations]
  )
  const session = React.useMemo(
    () => ({ ...activeSessionSlice, activeConversation }),
    [activeConversation, activeSessionSlice]
  )
  const [pendingMessage, setPendingMessage] = React.useState<PendingMessage | null>(null)
  const isCreatingSessionRef = React.useRef(false)

  React.useEffect(
    () =>
      window.api.sessions.onTitleUpdated(({ sessionId, title }) => {
        applyConversationTitle(sessionId, title)

        updateSession(sessionId, (instance) => {
          instance.conversation = { ...instance.conversation, title }
        })
      }),
    [applyConversationTitle, updateSession]
  )

  React.useEffect(() => {
    if (!pendingMessage) return

    void pendingMessage.session.chat.sendMessage({ parts: pendingMessage.parts })
  }, [pendingMessage])

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
        touchConversationActivity(existingSession.conversation.id, Date.now())
        setResponseState({ status: 'submitted', conversationId: existingSession.conversation.id })
        void existingSession.chat.sendMessage({ parts })
        return true
      }

      if (isCreatingSessionRef.current) return false

      isCreatingSessionRef.current = true
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
        const createdSession = activateNewSession(conversation, pendingProject)
        addConversation(conversation)
        setResponseState({ status: 'submitted', conversationId: conversation.id })
        setPendingMessage({ parts, session: createdSession })
        return true
      } finally {
        isCreatingSessionRef.current = false
      }
    },
    [
      activateNewSession,
      activeSession,
      addConversation,
      getResponse,
      pendingProject,
      getSession,
      setResponseState,
      touchConversationActivity
    ]
  )

  const stopResponse = React.useCallback((): void => {
    const currentResponse = activeSession ? getResponse(activeSession.conversationId) : undefined
    if (!currentResponse || currentResponse.conversationId !== activeSession?.conversationId) {
      return
    }

    const conversationId = currentResponse.conversationId
    const instance = getSession(conversationId)
    if (!instance) {
      settleResponse(conversationId)
      return
    }

    void instance.chat.stop().then(
      () => {
        instance.chat.messages = instance.chat.messages.map((message, index, messages) =>
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

    const instance = getSession(currentResponse.conversationId)
    if (!instance) return

    setResponseState({ status: 'submitted', conversationId: currentResponse.conversationId })
    void instance.chat.regenerate()
  }, [activeSession, getSession, getResponse, setResponseState])

  const renameConversation = React.useCallback(
    (conversationId: string, title: string): void => {
      const trimmedTitle = title.trim()
      if (!trimmedTitle) return

      void window.api.sessions
        .rename({ sessionId: conversationId, title: trimmedTitle })
        .then((summary) => {
          applyConversationTitle(conversationId, summary.title)

          updateSession(conversationId, (instance) => {
            instance.conversation = { ...instance.conversation, title: summary.title }
          })
        })
        .catch(() => undefined)
    },
    [applyConversationTitle, updateSession]
  )

  const deleteConversation = React.useCallback(
    (conversationId: string): void => {
      const instance = getSession(conversationId)
      const deletePersistedSession = async (): Promise<void> => {
        const currentResponse = getResponse(conversationId)
        if (instance && currentResponse) {
          await instance.chat.stop()
          settleResponse(conversationId)
        }
        await window.api.sessions.delete(conversationId)
        removeSession(conversationId)
        removeConversation(conversationId)
        closeSessionIfActive(conversationId)
      }

      void deletePersistedSession()
    },
    [
      closeSessionIfActive,
      getResponse,
      getSession,
      removeConversation,
      removeSession,
      settleResponse
    ]
  )

  const response: ChatResponseState = activeSession
    ? (responses.get(activeSession.conversationId) ?? IDLE_CHAT_RESPONSE)
    : IDLE_CHAT_RESPONSE
  const responseSlice = React.useMemo(
    () => ({
      response,
      respondingConversationIds,
      sendMessage,
      retryResponse,
      stopResponse
    }),
    [response, respondingConversationIds, retryResponse, sendMessage, stopResponse]
  )

  return {
    conversations,
    renameConversation,
    deleteConversation,
    session,
    responses: responseSlice
  }
}

export { useChatWorkspaceState, type ChatWorkspace, type ChatResponseSlice }
