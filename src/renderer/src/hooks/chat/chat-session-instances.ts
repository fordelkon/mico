import { Chat, useChat } from '@ai-sdk/react'
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

const transcriptSourceBrand: unique symbol = Symbol('ConversationTranscriptSource')

type ConversationTranscriptSource = {
  readonly conversationId: string
  readonly [transcriptSourceBrand]: true
}

const transcriptChats = new WeakMap<ConversationTranscriptSource, Chat<MicoUIMessage>>()
const emptyTranscriptChat = new Chat<MicoUIMessage>({ id: 'empty-transcript', messages: [] })

type ConversationTranscript = { messages: readonly MicoUIMessage[] }

/** Each reader retains the SDK's independent message subscription and throttle. */
function useConversationTranscript(
  source: ConversationTranscriptSource | null,
  options?: { throttleMs?: number }
): ConversationTranscript {
  const chat = source ? transcriptChats.get(source) : undefined
  const { messages } = useChat<MicoUIMessage>({
    chat: chat ?? emptyTranscriptChat,
    throttle: options?.throttleMs
  })
  return { messages }
}

type SessionRequestConfig = {
  modelEntryId: string | null
  thinkingEffort: ThinkingSelection | null
  permissionMode: PermissionMode
}

type ChatSessionView = {
  readonly conversation: Conversation
  readonly transcript: ConversationTranscriptSource
  readonly project: WorkspaceProject | null
  readonly requestConfig: Readonly<SessionRequestConfig>
}

// SDK instances and lifecycle gates belong exclusively to the session owner.
type ChatSession = {
  conversation: Conversation
  transcript: ConversationTranscriptSource
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

// The public view of a session instance: no SDK object and no lifecycle flags.
function toSessionView(instance: ChatSession): ChatSessionView {
  return {
    conversation: { ...instance.conversation },
    transcript: instance.transcript,
    project: instance.project ? { ...instance.project } : null,
    requestConfig: {
      modelEntryId: instance.modelEntryId,
      thinkingEffort: instance.thinkingEffort,
      permissionMode: instance.permissionMode
    }
  }
}

type ChatResponseControl = {
  responses: ReadonlyMap<string, ChatResponseUpdate>
  respondingConversationIds: ReadonlySet<string>
  sendMessage: (conversationId: string, parts: MicoUIMessage['parts']) => boolean
  queueFirstMessage: (conversationId: string, parts: MicoUIMessage['parts']) => void
  stopResponse: (conversationId: string) => void
  retryResponse: (conversationId: string) => void
  deleteConversation: (conversationId: string) => Promise<void>
}

type ChatCompactionState =
  | { status: 'pending'; requestId: string; error?: string }
  | { status: 'accepted' }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string }

type ChatCompactionsStore = {
  states: ReadonlyMap<string, ChatCompactionState>
  compactingConversationIds: ReadonlySet<string>
  startCompaction: (conversationId: string) => Promise<void>
  cancelCompaction: (conversationId: string) => Promise<void>
}

type ChatSessionsStore = {
  responseControl: ChatResponseControl
  compactions: ChatCompactionsStore
  contextEstimates: ReadonlyMap<string, number>
  getSession: (conversationId: string) => ChatSessionView | undefined
  refreshRecoveryIfStale: (conversationId: string) => void
  createSession: (
    conversation: Conversation,
    messages?: ChatMessage[],
    selection?: SessionRequestConfig,
    project?: WorkspaceProject | null,
    recovery?: SessionRecovery | null
  ) => ChatSessionView
  setRequestConfig: (conversationId: string, config: Partial<SessionRequestConfig>) => void
  updateConversationTitle: (conversationId: string, title: string) => void
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
  // Latest per-conversation approximate input observation; cleared when a conversation
  // starts a new request and never persisted as durable user text.
  const contextEstimatesRef = React.useRef(new Map<string, number>())
  const [contextEstimates, setContextEstimates] = React.useState<Map<string, number>>(
    () => new Map()
  )

  React.useEffect(() => {
    if (pendingMessage) void pendingMessage.chat.sendMessage({ parts: pendingMessage.parts })
  }, [pendingMessage])
  // Keep sessions alive across selection changes so background responses can continue.
  const sessionsRef = React.useRef(new Map<string, ChatSession>())
  const compactionsRef = React.useRef(new Map<string, ChatCompactionState>())
  const [compactionStates, setCompactionStates] = React.useState<
    ReadonlyMap<string, ChatCompactionState>
  >(() => new Map())
  const [compactingConversationIds, setCompactingConversationIds] = React.useState<
    ReadonlySet<string>
  >(() => new Set())
  const publishCompaction = React.useCallback((id: string, state: ChatCompactionState): void => {
    compactionsRef.current.set(id, state)
    setCompactionStates(new Map(compactionsRef.current))
    setCompactingConversationIds((current) => {
      const pending = state.status === 'pending'
      if (current.has(id) === pending) return current
      const next = new Set(current)
      if (pending) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])
  const startCompaction = React.useCallback(
    async (id: string): Promise<void> => {
      const instance = sessionsRef.current.get(id)
      if (compactionsRef.current.get(id)?.status === 'pending') return
      if (
        instance?.stopping ||
        instance?.deleting ||
        isActiveChatResponse(getResponse(id) ?? { status: 'idle' })
      )
        return
      const requestId = crypto.randomUUID()
      publishCompaction(id, { status: 'pending', requestId })
      try {
        const outcome = await window.api.sessions.compact({ sessionId: id, requestId })
        const current = compactionsRef.current.get(id)
        if (current?.status !== 'pending' || current.requestId !== requestId) return
        publishCompaction(
          id,
          outcome.status === 'failed'
            ? { status: 'failed', message: outcome.message }
            : { status: outcome.status }
        )
      } catch (error) {
        const current = compactionsRef.current.get(id)
        if (current?.status !== 'pending' || current.requestId !== requestId) return
        publishCompaction(id, {
          status: 'failed',
          message:
            error instanceof Error
              ? `Could not summarize this conversation. ${error.message} Your messages remain intact. Use /compact to try again.`
              : 'Could not summarize this conversation. Your messages remain intact. Use /compact to try again.'
        })
      }
    },
    [getResponse, publishCompaction]
  )
  const cancelCompaction = React.useCallback(
    async (id: string): Promise<void> => {
      const current = compactionsRef.current.get(id)
      if (current?.status !== 'pending') return
      try {
        await window.api.sessions.cancelCompact({ sessionId: id, requestId: current.requestId })
        // The compact result owns terminal state: cancellation may race durable acceptance.
      } catch {
        const latest = compactionsRef.current.get(id)
        if (latest?.status !== 'pending' || latest.requestId !== current.requestId) return
        publishCompaction(id, {
          ...latest,
          error:
            'Could not confirm summary cancellation. Try Cancel summary again or wait for the summary to finish.'
        })
      }
    },
    [publishCompaction]
  )

  const getSession = React.useCallback((conversationId: string): ChatSessionView | undefined => {
    const instance = sessionsRef.current.get(conversationId)
    return instance && toSessionView(instance)
  }, [])

  const removeSession = React.useCallback((conversationId: string): void => {
    sessionsRef.current.delete(conversationId)
    const hadCompaction = compactionsRef.current.delete(conversationId)
    if (hadCompaction) setCompactionStates(new Map(compactionsRef.current))
    setCompactingConversationIds((current) => {
      if (!hadCompaction || !current.has(conversationId)) return current
      const next = new Set(current)
      next.delete(conversationId)
      return next
    })
    contextEstimatesRef.current.delete(conversationId)
    setContextEstimates(new Map(contextEstimatesRef.current))
  }, [])

  const setContextEstimate = React.useCallback(
    (conversationId: string, tokens: number | null): void => {
      if (tokens === null) contextEstimatesRef.current.delete(conversationId)
      else contextEstimatesRef.current.set(conversationId, tokens)
      setContextEstimates(new Map(contextEstimatesRef.current))
    },
    []
  )

  const setRequestConfig = React.useCallback(
    (conversationId: string, config: Partial<SessionRequestConfig>): void => {
      const instance = sessionsRef.current.get(conversationId)
      if (!instance) return
      if (config.modelEntryId !== undefined) instance.modelEntryId = config.modelEntryId
      if (config.thinkingEffort !== undefined) instance.thinkingEffort = config.thinkingEffort
      if (config.permissionMode !== undefined) instance.permissionMode = config.permissionMode
    },
    []
  )

  const updateConversationTitle = React.useCallback(
    (conversationId: string, title: string): void => {
      const instance = sessionsRef.current.get(conversationId)
      if (instance) instance.conversation = { ...instance.conversation, title }
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
        compactionsRef.current.get(conversationId)?.status === 'pending' ||
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
            canRetry: persisted.recovery.canRetry,
            failureCode: persisted.recovery.failure.code
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
      selection: SessionRequestConfig = {
        modelEntryId: null,
        thinkingEffort: null,
        permissionMode: 'default'
      },
      project: WorkspaceProject | null = null,
      recovery?: SessionRecovery | null
    ): ChatSessionView => {
      const conversationId = conversation.id
      const transport = new ElectronChatTransport(window.api.chat, {
        sessionId: conversationId,
        getRetryRunId: () => sessionsRef.current.get(conversationId)?.recovery?.runId,
        getThinkingEffort: () =>
          sessionsRef.current.get(conversationId)?.thinkingEffort ?? 'default',
        getPermissionMode: () =>
          sessionsRef.current.get(conversationId)?.permissionMode ?? 'default',
        onStatusChange: (status) => {
          const currentResponse = getResponse(conversationId)
          if (
            !currentResponse ||
            currentResponse.status === 'error' ||
            currentResponse.status === 'settling'
          )
            return

          if (status.type === 'retrying') {
            onResponseState({
              status: 'retrying',
              conversationId,
              ...status,
              startedAt: Date.now()
            })
          } else if (
            currentResponse.status === 'submitted' ||
            currentResponse.status === 'retrying'
          ) {
            onResponseState({ status: 'streaming', conversationId })
          }
        },
        onContextMeasurement: (measurement) => {
          setContextEstimate(conversationId, measurement.estimatedInputTokens)
        }
      })
      const chat = new Chat<MicoUIMessage>({
        id: conversationId,
        messages: toUiMessages(messages),
        transport,
        onFinish: ({ isError }) => {
          if (!isError && !sessionsRef.current.get(conversationId)?.stopping)
            onResponseSettled(conversationId)
        },
        onError: (error) => {
          const instance = sessionsRef.current.get(conversationId)
          if (instance?.stopping) return
          onResponseState({
            status: 'error',
            conversationId,
            message: error.message,
            canRetry: false
          })
          // A retried attempt has one terminal refresh owned by its awaited regeneration.
          if (!instance?.retryInProgress) void refreshRecovery(conversationId)
        }
      })

      const transcript: ConversationTranscriptSource = {
        conversationId,
        [transcriptSourceBrand]: true
      }
      transcriptChats.set(transcript, chat)
      const session: ChatSession = {
        conversation,
        transcript,
        chat,
        transport,
        project,
        recovery,
        recoveryRevision: 0,
        ...selection
      }
      sessionsRef.current.set(conversationId, session)
      if (recovery)
        onResponseState({
          status: 'error',
          conversationId,
          message: recovery.blockedReason ?? recovery.failure.message,
          canRetry: recovery.canRetry,
          failureCode: recovery.failure.code
        })
      return toSessionView(session)
    },
    [getResponse, onResponseState, onResponseSettled, refreshRecovery, setContextEstimate]
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
      const instance = sessionsRef.current.get(conversationId)
      const current = getResponse(conversationId)
      if (
        !instance ||
        instance.stopping ||
        instance.deleting ||
        compactionsRef.current.get(conversationId)?.status === 'pending' ||
        (current && isActiveChatResponse(current))
      )
        return false
      instance.recoveryRevision = (instance.recoveryRevision ?? 0) + 1
      instance.recovery = null
      instance.recoveryNeedsRefresh = false
      instance.retryInProgress = false
      setContextEstimate(conversationId, null)
      onResponseState({ status: 'submitted', conversationId })
      void instance.chat.sendMessage({ parts })
      return true
    },
    [getResponse, onResponseState, setContextEstimate]
  )

  const queueFirstMessage = React.useCallback(
    (conversationId: string, parts: MicoUIMessage['parts']): void => {
      const instance = sessionsRef.current.get(conversationId)
      if (!instance) return
      setContextEstimate(conversationId, null)
      onResponseState({ status: 'submitted', conversationId })
      // The newly active chat must reach subscribers before its first message starts.
      setPendingMessage({ chat: instance.chat, parts })
    },
    [onResponseState, setContextEstimate]
  )

  const stopResponse = React.useCallback(
    (conversationId: string): void => {
      if (!getResponse(conversationId)) return
      const instance = sessionsRef.current.get(conversationId)
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
    [getResponse, onResponseState, onResponseSettled]
  )

  const retryResponse = React.useCallback(
    (conversationId: string): void => {
      if (getResponse(conversationId)?.status !== 'error') return
      const instance = sessionsRef.current.get(conversationId)
      if (
        !instance?.recovery?.canRetry ||
        instance.stopping ||
        instance.deleting ||
        compactionsRef.current.get(conversationId)?.status === 'pending'
      )
        return
      instance.recoveryRevision = (instance.recoveryRevision ?? 0) + 1
      const revision = instance.recoveryRevision
      instance.retryInProgress = true
      setContextEstimate(conversationId, null)
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
    [getResponse, onResponseState, refreshRecovery, setContextEstimate]
  )

  const refreshRecoveryIfStale = React.useCallback(
    (conversationId: string): void => {
      const instance = sessionsRef.current.get(conversationId)
      if (!instance?.recoveryNeedsRefresh) return
      void refreshRecovery(conversationId)
    },
    [refreshRecovery]
  )

  const deleteConversation = React.useCallback(
    async (conversationId: string): Promise<void> => {
      if (compactionsRef.current.get(conversationId)?.status === 'pending')
        throw new Error('Cancel the summary before deleting this conversation.')
      const instance = sessionsRef.current.get(conversationId)
      if (instance) instance.deleting = true
      try {
        if (instance && getResponse(conversationId)) {
          stopResponse(conversationId)
          await instance.stopping
        }
        await window.api.sessions.delete(conversationId)
        removeSession(conversationId)
      } catch (error) {
        if (instance) instance.deleting = false
        throw error
      }
    },
    [getResponse, removeSession, stopResponse]
  )

  const responseControl = React.useMemo(
    () => ({
      responses,
      respondingConversationIds,
      sendMessage,
      queueFirstMessage,
      stopResponse,
      retryResponse,
      deleteConversation
    }),
    [
      responses,
      respondingConversationIds,
      sendMessage,
      queueFirstMessage,
      stopResponse,
      retryResponse,
      deleteConversation
    ]
  )

  return {
    getSession,
    refreshRecoveryIfStale,
    createSession,
    setRequestConfig,
    updateConversationTitle,
    responseControl,
    contextEstimates,
    compactions: {
      states: compactionStates,
      compactingConversationIds,
      startCompaction,
      cancelCompaction
    }
  }
}

export {
  type ChatCompactionState,
  type ChatCompactionsStore,
  type ChatSessionView,
  type ChatSessionsStore,
  type ConversationTranscriptSource,
  useChatSessions,
  useConversationTranscript
}
