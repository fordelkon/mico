import {
  type ChatResponseState,
  IDLE_CHAT_RESPONSE,
  isActiveChatResponse,
  type ChatRetryState,
  type MicoUIMessage
} from '@renderer/types/chat'
import type { ChatSkillInvocationPart } from '@shared/ai/skills'
import type { ChatDocumentPart } from '@shared/data/schemas/chat'
import * as React from 'react'
import { type ChatCompactionsStore, useChatSessions } from './chat-session-instances'
import { type ChatActiveSessionSlice, useActiveSession } from './use-active-session'
import { useConversationList } from './use-conversation-list'

type ChatSendInput = {
  text: string
  documents: ChatDocumentPart[]
  skillInvocation?: ChatSkillInvocationPart['data']
}

/** Response control for the workspace: state, and the actions that drive it. */
type ChatResponseSlice = {
  response: ChatResponseState
  estimatedInputTokens?: number
  respondingConversationIds: ReadonlySet<string>
  isTurnActive: boolean
  composerMode: 'send' | 'stop' | 'disabled'
  errorMessage?: string
  failureCode?: Extract<ChatResponseState, { status: 'error' }>['failureCode']
  retry?: ChatRetryState
  canRetry: boolean
  sendMessage: (content: ChatSendInput) => Promise<boolean>
  retryResponse: () => void
  stopResponse: () => void
}

type ChatWorkspace = {
  conversations: ReturnType<typeof useConversationList>['conversations']
  renameConversation: (conversationId: string, title: string) => Promise<void>
  deleteConversation: (conversationId: string) => Promise<void>
  compactions: ChatCompactionsStore
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
  const sessions = useChatSessions()
  const {
    responses,
    respondingConversationIds,
    sendMessage: sendSessionMessage,
    queueFirstMessage,
    stopResponse: stopSessionResponse,
    retryResponse: retrySessionResponse,
    deleteConversation: deleteSession
  } = sessions.responseControl
  const conversationList = useConversationList()
  const {
    addConversation,
    applyConversationTitle,
    conversations,
    removeConversation,
    touchConversationActivity
  } = conversationList
  const { getSession, updateConversationTitle } = sessions
  const activeSessionSlice = useActiveSession({ sessions })
  const { activeSession, createNewSession, closeSessionIfActive, ...publicSessionSlice } =
    activeSessionSlice
  const activeConversation = React.useMemo(
    () =>
      activeSession
        ? (conversations.find(({ id }) => id === activeSession.conversationId) ?? null)
        : null,
    [activeSession, conversations]
  )
  const session = React.useMemo(
    () => ({ ...publicSessionSlice, activeSession, activeConversation }),
    [activeConversation, activeSession, publicSessionSlice]
  )
  const isCreatingSessionRef = React.useRef(false)

  React.useEffect(
    () =>
      window.api.sessions.onTitleUpdated(({ sessionId, title }) => {
        applyConversationTitle(sessionId, title)

        updateConversationTitle(sessionId, title)
      }),
    [applyConversationTitle, updateConversationTitle]
  )

  const sendMessage = React.useCallback(
    async ({ text, documents, skillInvocation }: ChatSendInput): Promise<boolean> => {
      if (!text.trim() && !documents.length) return false

      const existingSession = activeSession ? getSession(activeSession.conversationId) : undefined
      const parts: MicoUIMessage['parts'] = []
      if (text.trim()) parts.push({ type: 'text', text })
      for (const document of documents) parts.push({ type: 'data-document', data: document })
      if (skillInvocation) parts.push({ type: 'data-skill-invocation', data: skillInvocation })

      if (existingSession) {
        const sent = sendSessionMessage(existingSession.conversation.id, parts)
        if (sent) touchConversationActivity(existingSession.conversation.id, Date.now())
        return sent
      }

      if (isCreatingSessionRef.current) return false

      isCreatingSessionRef.current = true
      try {
        const conversation = await createNewSession()
        addConversation(conversation)
        queueFirstMessage(conversation.id, parts)
        return true
      } finally {
        isCreatingSessionRef.current = false
      }
    },
    [
      createNewSession,
      activeSession,
      addConversation,
      sendSessionMessage,
      getSession,
      queueFirstMessage,
      touchConversationActivity
    ]
  )

  const stopResponse = React.useCallback((): void => {
    if (activeSession) stopSessionResponse(activeSession.conversationId)
  }, [activeSession, stopSessionResponse])

  const retryResponse = React.useCallback((): void => {
    if (activeSession) retrySessionResponse(activeSession.conversationId)
  }, [activeSession, retrySessionResponse])

  const renameConversation = React.useCallback(
    async (conversationId: string, title: string): Promise<void> => {
      const trimmedTitle = title.trim()
      if (!trimmedTitle) return

      try {
        const summary = await window.api.sessions.rename({
          sessionId: conversationId,
          title: trimmedTitle
        })
        applyConversationTitle(conversationId, summary.title)
        updateConversationTitle(conversationId, summary.title)
      } catch (error) {
        throw new Error(
          'Could not rename this conversation. Your title was not saved. Try renaming it again.',
          { cause: error }
        )
      }
    },
    [applyConversationTitle, updateConversationTitle]
  )

  const deleteConversation = React.useCallback(
    async (conversationId: string): Promise<void> => {
      try {
        await deleteSession(conversationId)
        removeConversation(conversationId)
        closeSessionIfActive(conversationId)
      } catch (error) {
        throw new Error(
          'Could not delete this conversation. It remains in your history. Try deleting it again.',
          { cause: error }
        )
      }
    },
    [closeSessionIfActive, deleteSession, removeConversation]
  )

  const response: ChatResponseState = activeSession
    ? (responses.get(activeSession.conversationId) ?? IDLE_CHAT_RESPONSE)
    : IDLE_CHAT_RESPONSE
  const isForActiveConversation =
    response.status !== 'idle' && activeConversation?.id === response.conversationId
  const isTurnActive = isActiveChatResponse(response) && isForActiveConversation
  const compactionState = activeConversation
    ? sessions.compactions.states.get(activeConversation.id)
    : undefined
  const composerMode: ChatResponseSlice['composerMode'] =
    compactionState?.status === 'pending'
      ? 'disabled'
      : !isActiveChatResponse(response)
        ? 'send'
        : isTurnActive && response.status !== 'settling'
          ? 'stop'
          : 'disabled'
  const errorMessage =
    response.status === 'error' && isForActiveConversation ? response.message : undefined
  const failureCode =
    response.status === 'error' && isForActiveConversation ? response.failureCode : undefined
  const retry = response.status === 'retrying' && isForActiveConversation ? response : undefined
  const canRetry = Boolean(
    errorMessage && response.status === 'error' && response.canRetry !== false
  )
  const responseSlice = React.useMemo(
    () => ({
      response,
      isTurnActive,
      composerMode,
      errorMessage,
      failureCode,
      retry,
      canRetry,
      estimatedInputTokens: activeSession
        ? sessions.contextEstimates.get(activeSession.conversationId)
        : undefined,
      respondingConversationIds,
      sendMessage,
      retryResponse,
      stopResponse
    }),
    [
      response,
      isTurnActive,
      composerMode,
      errorMessage,
      failureCode,
      retry,
      canRetry,
      respondingConversationIds,
      retryResponse,
      sendMessage,
      stopResponse,
      activeSession,
      sessions.contextEstimates
    ]
  )

  return {
    conversations,
    compactions: sessions.compactions,
    renameConversation,
    deleteConversation,
    session,
    responses: responseSlice
  }
}

export { type ChatResponseSlice, type ChatWorkspace, useChatWorkspaceState }
