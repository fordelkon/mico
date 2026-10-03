import { Chat } from '@ai-sdk/react'
import * as React from 'react'

import { ElectronChatTransport } from '@renderer/services/ai-transport/electron-chat-transport'
import {
  isActiveChatResponse,
  type ChatResponseState,
  type Conversation,
  type MicoUIMessage
} from '@renderer/types/chat'
import type { ChatMessage, ThinkingSelection } from '@shared/data/schemas/chat'
import type { WorkspaceProject } from '@shared/data/schemas/workspace'
import type { PermissionMode } from '@shared/ai/permissions'

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
  modelEntryId: string | null
  thinkingEffort: ThinkingSelection | null
  project: WorkspaceProject | null
  permissionMode: PermissionMode
}

function toUiMessages(messages: ChatMessage[]): MicoUIMessage[] {
  return messages.map((message) => ({
    id: crypto.randomUUID(),
    role: message.role,
    metadata: message.metadata,
    parts: message.parts.flatMap<MicoUIMessage['parts'][number]>((part) => {
      if (part.type === 'document') return [{ type: 'data-document', data: part }]
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
  createSession: (
    conversation: Conversation,
    messages?: ChatMessage[],
    selection?: Pick<ChatSession, 'modelEntryId' | 'thinkingEffort'>,
    project?: WorkspaceProject | null
  ) => ChatSession
  updateSession: (conversationId: string, patch: (session: ChatSession) => void) => void
}

function useChatSessions(options: {
  getThinkingEffort: () => ThinkingSelection
}): ChatSessionsStore {
  const { getThinkingEffort } = options
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

  const createSession = React.useCallback(
    (
      conversation: Conversation,
      messages: ChatMessage[] = [],
      selection: Pick<ChatSession, 'modelEntryId' | 'thinkingEffort'> = {
        modelEntryId: null,
        thinkingEffort: null
      },
      project: WorkspaceProject | null = null
    ): ChatSession => {
      const chat = new Chat<MicoUIMessage>({
        id: conversation.id,
        messages: toUiMessages(messages),
        transport: new ElectronChatTransport(window.api.chat, {
          sessionId: conversation.id,
          getThinkingEffort,
          getPermissionMode: () =>
            sessionsRef.current.get(conversation.id)?.permissionMode ?? 'default',
          onStatusChange: (status) => {
            const currentResponse = getResponse(conversation.id)
            if (!currentResponse || currentResponse.status === 'error') return

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
        }),
        onFinish: ({ isError }) => {
          if (!isError) onResponseSettled(conversation.id)
        },
        onError: (error) =>
          onResponseState({
            status: 'error',
            conversationId: conversation.id,
            message: error.message
          })
      })

      const session: ChatSession = {
        conversation,
        chat,
        project,
        permissionMode: 'default',
        ...selection
      }
      sessionsRef.current.set(conversation.id, session)
      return session
    },
    [getThinkingEffort, getResponse, onResponseState, onResponseSettled]
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
      if (!instance || (current && isActiveChatResponse(current))) return false
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
      void instance.chat.stop().then(
        () => {
          instance.chat.messages = instance.chat.messages.map((message, index, messages) =>
            index === messages.length - 1 && message.role === 'assistant'
              ? {
                  ...message,
                  metadata: { ...message.metadata, completionState: 'stopped' as const }
                }
              : message
          )
          onResponseSettled(conversationId)
        },
        () => onResponseSettled(conversationId)
      )
    },
    [getSession, getResponse, onResponseSettled]
  )

  const retryResponse = React.useCallback(
    (conversationId: string): void => {
      if (getResponse(conversationId)?.status !== 'error') return
      const instance = getSession(conversationId)
      if (!instance) return
      onResponseState({ status: 'submitted', conversationId })
      void instance.chat.regenerate()
    },
    [getSession, getResponse, onResponseState]
  )

  const prepareForDeletion = React.useCallback(
    async (conversationId: string): Promise<void> => {
      const instance = getSession(conversationId)
      if (instance && getResponse(conversationId)) {
        // Deletion must not continue if stopping fails, unlike the interactive stop action.
        await instance.chat.stop()
        onResponseSettled(conversationId)
      }
    },
    [getSession, getResponse, onResponseSettled]
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

  return { getSession, removeSession, createSession, updateSession, responseControl }
}

export { useChatSessions, type ChatSession, type ChatSessionsStore }
