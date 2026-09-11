import { Chat, useChat } from '@ai-sdk/react'
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

const EMPTY_MESSAGES: MicoUIMessage[] = []
// A bounded commit rate keeps long streamed Markdown from exhausting the renderer.
const STREAMING_UPDATE_THROTTLE_MS = 50

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
  activeMessages: MicoUIMessage[]
  response: ChatResponseState
  respondingConversationIds: string[]
  reasoningCapabilities: ModelReasoningCapabilities | null
  thinkingEffort: ThinkingSelection
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
    parts: message.parts.flatMap((part) =>
      part.type === 'text' ? [{ type: 'text', text: part.text, state: 'done' as const }] : []
    )
  }))
}

function useChatWorkspaceState(): ChatWorkspace {
  // Keep sessions alive across selection changes so background responses can continue.
  const sessionsRef = React.useRef(new Map<string, ChatSession>())
  const [conversations, setConversations] = React.useState<Conversation[]>([])
  const [activeSession, setActiveSession] = React.useState<ActiveChatSession | null>(null)
  const [responses, setResponses] = React.useState<Map<string, ActiveChatResponse>>(() => new Map())
  const [pendingMessage, setPendingMessage] = React.useState<PendingMessage | null>(null)
  const [reasoningCapabilities, setReasoningCapabilities] =
    React.useState<ModelReasoningCapabilities | null>(null)
  const [thinkingEffort, setThinkingEffortState] = React.useState<ThinkingSelection>('default')
  const [thinkingEffortStore] = React.useState(() => new ThinkingEffortStore())
  const getThinkingEffort = React.useCallback(
    () => thinkingEffortStore.get(),
    [thinkingEffortStore]
  )
  // Response actions can run before React commits, so they need the latest synchronous values.
  const responseRef = React.useRef<Map<string, ActiveChatResponse>>(new Map())
  const isCreatingSessionRef = React.useRef(false)
  const [composerFocusKey, setComposerFocusKey] = React.useState(1)
  const [idleChat] = React.useState(
    () =>
      new Chat<MicoUIMessage>({
        id: 'empty-chat',
        transport: new ElectronChatTransport(window.api.chat, {
          conversationId: 'empty-chat',
          getThinkingEffort
        })
      })
  )

  const setThinkingEffort = React.useCallback(
    (next: ThinkingSelection): void => {
      thinkingEffortStore.set(next)
      setThinkingEffortState(next)
    },
    [thinkingEffortStore]
  )

  React.useEffect(() => {
    let active = true

    void window.api.chat.getCapabilities().then(
      (capabilities) => {
        if (!active || !capabilities) return

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
      window.api.sessions.onTitleUpdated(({ conversationId, title }) => {
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === conversationId ? { ...conversation, title } : conversation
          )
        )

        const session = sessionsRef.current.get(conversationId)
        if (session) session.conversation = { ...session.conversation, title }
      }),
    []
  )

  const setResponseState = React.useCallback((next: ActiveChatResponse): void => {
    responseRef.current.set(next.conversationId, next)
    setResponses(new Map(responseRef.current))
  }, [])

  const settleResponse = React.useCallback((conversationId: string): void => {
    if (!responseRef.current.delete(conversationId)) return
    setResponses(new Map(responseRef.current))
  }, [])

  const createSession = React.useCallback(
    (conversation: Conversation, messages: ChatMessage[] = []): ChatSession => {
      const chat = new Chat<MicoUIMessage>({
        id: conversation.id,
        messages: toUiMessages(messages),
        transport: new ElectronChatTransport(window.api.chat, {
          conversationId: conversation.id,
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
            } else if (currentResponse.status === 'retrying') {
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

      const session = { conversation, chat }
      sessionsRef.current.set(conversation.id, session)
      return session
    },
    [getThinkingEffort, setResponseState, settleResponse]
  )

  const subscribedChat = activeSession?.chat ?? idleChat
  const { messages: subscribedMessages, status: subscribedStatus } = useChat<MicoUIMessage>({
    chat: subscribedChat,
    throttle: STREAMING_UPDATE_THROTTLE_MS
  })
  const activeMessages = activeSession ? subscribedMessages : EMPTY_MESSAGES

  React.useEffect(() => {
    if (!pendingMessage) return

    void pendingMessage.session.chat.sendMessage({ text: pendingMessage.content })
  }, [pendingMessage])

  // Do not let a newly selected session inherit the status of another conversation's response.
  React.useEffect(() => {
    const currentResponse = activeSession
      ? responseRef.current.get(activeSession.conversationId)
      : undefined

    if (
      activeSession &&
      (currentResponse?.status === 'submitted' || currentResponse?.status === 'streaming') &&
      (subscribedStatus === 'submitted' || subscribedStatus === 'streaming') &&
      currentResponse.status !== subscribedStatus
    ) {
      setResponseState({
        status: subscribedStatus,
        conversationId: activeSession.conversationId
      })
    }
  }, [activeSession, setResponseState, subscribedStatus])

  const startNewChat = React.useCallback((): void => {
    setActiveSession(null)
    // A new token requests focus without coupling the workspace to the textarea ref.
    setComposerFocusKey((key) => key + 1)
  }, [])

  const selectConversation = React.useCallback(
    (conversationId: string, { focusComposer = true }: { focusComposer?: boolean } = {}): void => {
      const existing = sessionsRef.current.get(conversationId)
      if (existing) {
        setActiveSession({ conversationId, chat: existing.chat })
        if (focusComposer) setComposerFocusKey((key) => key + 1)
        return
      }

      void window.api.sessions.load(conversationId).then((persisted) => {
        const session = createSession(
          { id: persisted.id, title: persisted.title },
          persisted.messages
        )
        setActiveSession({ conversationId: persisted.id, chat: session.chat })
        if (focusComposer) setComposerFocusKey((key) => key + 1)
      })
    },
    [createSession]
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
      void window.api.sessions
        .create({ title: 'New chat' })
        .then((summary) => {
          const conversation = { id: summary.id, title: summary.title }
          const session = createSession(conversation)
          setConversations((current) => [...current, conversation])
          setActiveSession({ conversationId: conversation.id, chat: session.chat })
          setResponseState({ status: 'submitted', conversationId: conversation.id })
          setPendingMessage({ content, session })
        })
        .finally(() => {
          isCreatingSessionRef.current = false
        })
    },
    [activeSession, createSession, setResponseState]
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
      void idleChat.stop()
    },
    [idleChat]
  )

  const activeConversation = React.useMemo(
    () =>
      activeSession
        ? (conversations.find((conversation) => conversation.id === activeSession.conversationId) ??
          null)
        : null,
    [activeSession, conversations]
  )
  const response = activeSession
    ? (responses.get(activeSession.conversationId) ?? IDLE_CHAT_RESPONSE)
    : IDLE_CHAT_RESPONSE
  const respondingConversationIds = React.useMemo(
    () =>
      [...responses.values()]
        .filter(
          ({ status }) => status === 'submitted' || status === 'streaming' || status === 'retrying'
        )
        .map(({ conversationId }) => conversationId),
    [responses]
  )

  return React.useMemo(
    () => ({
      conversations,
      activeConversation,
      activeMessages,
      response,
      respondingConversationIds,
      reasoningCapabilities,
      thinkingEffort,
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
      activeMessages,
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
      startNewChat,
      stopResponse,
      thinkingEffort
    ]
  )
}

export { useChatWorkspaceState, type ChatWorkspace }
