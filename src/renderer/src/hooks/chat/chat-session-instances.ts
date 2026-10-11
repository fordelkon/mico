import { Chat } from '@ai-sdk/react'
import { ElectronChatTransport } from '@renderer/services/ai-transport/electron-chat-transport'
import {
  type ChatResponseState,
  type Conversation,
  isActiveChatResponse,
  type MicoUIMessage
} from '@renderer/types/chat'
import type { PermissionMode } from '@shared/ai/permissions'
import type { ChatMessage, ThinkingSelection } from '@shared/data/schemas/chat'
import type { SessionRecovery } from '@shared/data/schemas/session'
import type { WorkspaceProject } from '@shared/data/schemas/workspace'
import * as React from 'react'

// A conversation's response in any state other than idle: the map only holds
// conversations with something to show, and removal settles the response.
type ChatResponseUpdate = Exclude<ChatResponseState, { status: 'idle' }>

type ChatResponsesStore = {
  responses: Map<string, ChatResponseUpdate>
  respondingConversationIds: ReadonlySet<string>
  getResponse: (conversationId: string) => ChatResponseUpdate | undefined
  setResponseState: (next: ChatResponseUpdate) => void
  settleResponse: (conversationId: string) => void
}

function useChatResponses(): ChatResponsesStore {
  const [responses, setResponses] = React.useState<Map<string, ChatResponseUpdate>>(() => new Map())
  const [respondingConversationIds, setRespondingConversationIds] = React.useState<
    ReadonlySet<string>
  >(() => new Set())
  // Response actions can run before React commits, so they need the latest synchronous values.
  const responseRef = React.useRef<Map<string, ChatResponseUpdate>>(new Map())

  const getResponse = React.useCallback(
    (conversationId: string): ChatResponseUpdate | undefined =>
      responseRef.current.get(conversationId),
    []
  )

  const setResponseState = React.useCallback((next: ChatResponseUpdate): void => {
    responseRef.current.set(next.conversationId, next)
    setResponses(new Map(responseRef.current))
    setRespondingConversationIds((current) => {
      const currentlyResponding = current.has(next.conversationId)
      const nextResponding = isActiveChatResponse(next)
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

  return { responses, respondingConversationIds, getResponse, setResponseState, settleResponse }
}

type ChatSession = {
  conversation: Conversation
  chat: Chat<MicoUIMessage>
  transport: ElectronChatTransport
  stopping?: Promise<void>
  deleting?: boolean
  cancellationFailed?: boolean
  modelEntryId: string | null
  thinkingEffort: ThinkingSelection | null
  project: WorkspaceProject | null
  permissionMode: PermissionMode
  recovery?: SessionRecovery | null
  recoveryRevision?: number
  recoveryNeedsRefresh?: boolean
  retryInProgress?: boolean
}

function toUiMessages(messages: ChatMessage[]): MicoUIMessage[] {
  return messages.map((message) => ({
    id: crypto.randomUUID(),
    role: message.role,
    metadata: message.metadata,
    parts: message.parts.flatMap<MicoUIMessage['parts'][number]>((part) => {
      if (part.type === 'document') return [{ type: 'data-document', data: part }]
      if (part.type === 'data-skill-invocation') return [{ type: part.type, data: part.data }]
      if (part.type === 'tool-trace') {
        if (part.state === 'output-error') {
          return [
            {
              type: 'dynamic-tool',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: { ...part.input, __micoPresentation: part.presentation },
              state: 'output-error',
              errorText: part.errorText
            }
          ]
        }
        return [
          {
            type: 'dynamic-tool',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: { ...part.input, __micoPresentation: part.presentation },
            state: 'output-available',
            output: part.output
          }
        ]
      }
      if (part.type === 'text') return [{ type: 'text', text: part.text, state: 'done' }]
      if (part.type === 'reasoning') return [{ type: 'reasoning', text: part.text, state: 'done' }]
      return []
    })
  }))
}

type ChatResponseControl = {
  responses: ReadonlyMap<string, ChatResponseUpdate>
  respondingConversationIds: ReadonlySet<string>
  sendMessage: (conversationId: string, parts: MicoUIMessage['parts']) => boolean
  queueFirstMessage: (conversationId: string, parts: MicoUIMessage['parts']) => void
  stopResponse: (conversationId: string) => void
  retryResponse: (conversationId: string) => void
  prepareForDeletion: (conversationId: string) => Promise<void>
}

type ChatSessionsStore = {
  responseControl: ChatResponseControl
  getSession: (conversationId: string) => ChatSession | undefined
  removeSession: (conversationId: string) => void
  refreshRecovery: (conversationId: string) => Promise<void>
  createSession: (
    conversation: Conversation,
    messages?: ChatMessage[],
    selection?: Pick<ChatSession, 'modelEntryId' | 'thinkingEffort'>,
    project?: WorkspaceProject | null,
    recovery?: SessionRecovery | null
  ) => ChatSession
  updateSession: (conversationId: string, patch: (session: ChatSession) => void) => void
}

function useChatSessions(): ChatSessionsStore {
  const {
    responses,
    respondingConversationIds,
    getResponse,
    setResponseState: onResponseState,
    settleResponse: onResponseSettled
  } = useChatResponses()
  const [pendingMessage, setPendingMessage] = React.useState<{
    chat: Chat<MicoUIMessage>
    parts: MicoUIMessage['parts']
  } | null>(null)

  React.useEffect(() => {
    if (pendingMessage) void pendingMessage.chat.sendMessage({ parts: pendingMessage.parts })
  }, [pendingMessage])
  // Keep sessions alive across selection changes so background responses can continue.
  const sessionsRef = React.useRef(new Map<string, ChatSession>())

  const getSession = React.useCallback(
    (conversationId: string): ChatSession | undefined => sessionsRef.current.get(conversationId),
    []
  )

  const removeSession = React.useCallback((conversationId: string): void => {
    sessionsRef.current.delete(conversationId)
  }, [])

  const updateSession = React.useCallback(
    (conversationId: string, patch: (session: ChatSession) => void): void => {
      const session = sessionsRef.current.get(conversationId)
      if (session) patch(session)
    },
    []
  )

  const refreshRecovery = React.useCallback(
    async (conversationId: string): Promise<void> => {
      const instance = sessionsRef.current.get(conversationId)
      if (!instance) return
      const cancellationRevision = instance.recoveryRevision
      if (instance.cancellationFailed) {
        try {
          await instance.transport.retryCancellation()
          if (
            sessionsRef.current.get(conversationId) !== instance ||
            instance.recoveryRevision !== cancellationRevision ||
            !instance.cancellationFailed
          )
            return
          instance.stopping = undefined
          instance.cancellationFailed = false
          onResponseSettled(conversationId)
        } catch {
          return
        }
      }
      const currentResponse = getResponse(conversationId)
      if (
        instance.stopping ||
        instance.deleting ||
        (currentResponse && isActiveChatResponse(currentResponse))
      )
        return
      const revision = instance.recoveryRevision
      const isCurrent = (): boolean =>
        sessionsRef.current.get(conversationId) === instance &&
        instance.recoveryRevision === revision &&
        !instance.stopping &&
        !instance.deleting &&
        !isActiveChatResponse(getResponse(conversationId) ?? { status: 'idle' })
      try {
        const persisted = await window.api.sessions.load(conversationId)
        if (!isCurrent()) return
        instance.chat.messages = toUiMessages(persisted.messages)
        instance.recovery = persisted.recovery
        instance.recoveryNeedsRefresh = false
        if (persisted.recovery)
          onResponseState({
            status: 'error',
            conversationId,
            message: persisted.recovery.blockedReason ?? persisted.recovery.failure.message,
            canRetry: persisted.recovery.canRetry
          })
        else onResponseSettled(conversationId)
      } catch {
        if (!isCurrent()) return
        instance.recoveryNeedsRefresh = true
        onResponseState({
          status: 'error',
          conversationId,
          message:
            'Could not reload the saved conversation. Select this conversation again to restore its messages and recovery details.',
          canRetry: false
        })
      }
    },
    [getResponse, onResponseState, onResponseSettled]
  )

  const createSession = React.useCallback(
    (
      conversation: Conversation,
      messages: ChatMessage[] = [],
      selection: Pick<ChatSession, 'modelEntryId' | 'thinkingEffort'> = {
        modelEntryId: null,
        thinkingEffort: null
      },
      project: WorkspaceProject | null = null,
      recovery?: SessionRecovery | null
    ): ChatSession => {
      const transport = new ElectronChatTransport(window.api.chat, {
        sessionId: conversation.id,
        getRetryRunId: () => sessionsRef.current.get(conversation.id)?.recovery?.runId,
        getThinkingEffort: () =>
          sessionsRef.current.get(conversation.id)?.thinkingEffort ?? 'default',
        getPermissionMode: () =>
          sessionsRef.current.get(conversation.id)?.permissionMode ?? 'default',
        onStatusChange: (status) => {
          const currentResponse = getResponse(conversation.id)
          if (
            !currentResponse ||
            currentResponse.status === 'error' ||
            currentResponse.status === 'settling'
          )
            return

          if (status.type === 'retrying') {
            onResponseState({
              status: 'retrying',
              conversationId: conversation.id,
              ...status,
              startedAt: Date.now()
            })
          } else if (
            currentResponse.status === 'submitted' ||
            currentResponse.status === 'retrying'
          ) {
            onResponseState({ status: 'streaming', conversationId: conversation.id })
          }
        }
      })
      const chat = new Chat<MicoUIMessage>({
        id: conversation.id,
        messages: toUiMessages(messages),
        transport,
        onFinish: ({ isError }) => {
          if (!isError && !sessionsRef.current.get(conversation.id)?.stopping)
            onResponseSettled(conversation.id)
        },
        onError: (error) => {
          const instance = sessionsRef.current.get(conversation.id)
          if (instance?.stopping) return
          onResponseState({
            status: 'error',
            conversationId: conversation.id,
            message: error.message,
            canRetry: false
          })
          // A retried attempt has one terminal refresh owned by its awaited regeneration.
          if (!instance?.retryInProgress) void refreshRecovery(conversation.id)
        }
      })

      const session: ChatSession = {
        conversation,
        chat,
        transport,
        project,
        permissionMode: 'default',
        recovery,
        recoveryRevision: 0,
        ...selection
      }
      sessionsRef.current.set(conversation.id, session)
      if (recovery)
        onResponseState({
          status: 'error',
          conversationId: conversation.id,
          message: recovery.blockedReason ?? recovery.failure.message,
          canRetry: recovery.canRetry
        })
      return session
    },
    [getResponse, onResponseState, onResponseSettled, refreshRecovery]
  )

  React.useEffect(
    () => () => {
      // Sessions may continue streaming after navigation; stop all of them when the workspace unmounts.
      for (const { chat } of sessionsRef.current.values()) {
        void chat.stop()
      }
    },
    []
  )

  const sendMessage = React.useCallback(
    (conversationId: string, parts: MicoUIMessage['parts']): boolean => {
      const instance = getSession(conversationId)
      const current = getResponse(conversationId)
      if (
        !instance ||
        instance.stopping ||
        instance.deleting ||
        (current && isActiveChatResponse(current))
      )
        return false
      instance.recoveryRevision = (instance.recoveryRevision ?? 0) + 1
      instance.recovery = null
      instance.recoveryNeedsRefresh = false
      instance.retryInProgress = false
      onResponseState({ status: 'submitted', conversationId })
      void instance.chat.sendMessage({ parts })
      return true
    },
    [getSession, getResponse, onResponseState]
  )

  const queueFirstMessage = React.useCallback(
    (conversationId: string, parts: MicoUIMessage['parts']): void => {
      const instance = getSession(conversationId)
      if (!instance) return
      onResponseState({ status: 'submitted', conversationId })
      // The newly active chat must reach subscribers before its first message starts.
      setPendingMessage({ chat: instance.chat, parts })
    },
    [getSession, onResponseState]
  )

  const stopResponse = React.useCallback(
    (conversationId: string): void => {
      if (!getResponse(conversationId)) return
      const instance = getSession(conversationId)
      if (!instance) {
        onResponseSettled(conversationId)
        return
      }
      instance.recoveryRevision = (instance.recoveryRevision ?? 0) + 1
      instance.retryInProgress = false
      if (instance.stopping) return
      onResponseState({ status: 'settling', conversationId })
      instance.stopping = (async () => {
        await instance.chat.stop()
        await instance.transport.awaitCancellation()
      })()
      void instance.stopping.then(
        () => {
          instance.chat.messages = instance.chat.messages.map((message, index, messages) =>
            index === messages.length - 1 && message.role === 'assistant'
              ? {
                  ...message,
                  metadata: { ...message.metadata, completionState: 'stopped' as const }
                }
              : message
          )
          instance.stopping = undefined
          onResponseSettled(conversationId)
        },
        () => {
          instance.cancellationFailed = true
          instance.recoveryNeedsRefresh = true
          onResponseState({
            status: 'error',
            conversationId,
            canRetry: false,
            message:
              'Could not confirm that the response stopped. Reopen this conversation before sending or deleting it.'
          })
        }
      )
    },
    [getSession, getResponse, onResponseState, onResponseSettled]
  )

  const retryResponse = React.useCallback(
    (conversationId: string): void => {
      if (getResponse(conversationId)?.status !== 'error') return
      const instance = getSession(conversationId)
      if (!instance?.recovery?.canRetry) return
      instance.recoveryRevision = (instance.recoveryRevision ?? 0) + 1
      const revision = instance.recoveryRevision
      instance.retryInProgress = true
      onResponseState({ status: 'submitted', conversationId })
      void instance.chat
        .regenerate()
        .then(async () => {
          if (
            instance.recoveryRevision !== revision ||
            sessionsRef.current.get(conversationId) !== instance
          )
            return
          instance.retryInProgress = false
          await refreshRecovery(conversationId)
        })
        .catch(() => {
          if (
            instance.recoveryRevision !== revision ||
            sessionsRef.current.get(conversationId) !== instance
          )
            return
          instance.retryInProgress = false
          void refreshRecovery(conversationId)
        })
    },
    [getSession, getResponse, onResponseState, refreshRecovery]
  )

  const prepareForDeletion = React.useCallback(
    async (conversationId: string): Promise<void> => {
      const instance = getSession(conversationId)
      if (!instance) return
      instance.deleting = true
      if (getResponse(conversationId)) {
        stopResponse(conversationId)
        await instance.stopping
      }
    },
    [getSession, getResponse, stopResponse]
  )

  const responseControl = React.useMemo(
    () => ({
      responses,
      respondingConversationIds,
      sendMessage,
      queueFirstMessage,
      stopResponse,
      retryResponse,
      prepareForDeletion
    }),
    [
      responses,
      respondingConversationIds,
      sendMessage,
      queueFirstMessage,
      stopResponse,
      retryResponse,
      prepareForDeletion
    ]
  )

  return {
    getSession,
    removeSession,
    createSession,
    updateSession,
    refreshRecovery,
    responseControl
  }
}

export { type ChatSession, type ChatSessionsStore, useChatSessions }
