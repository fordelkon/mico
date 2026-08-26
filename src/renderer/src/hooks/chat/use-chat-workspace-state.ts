import { Chat, useChat } from '@ai-sdk/react'
import * as React from 'react'

import {
  IDLE_CHAT_RESPONSE,
  type ChatResponseState,
  type Conversation,
  type MicoUIMessage
} from '@renderer/lib/ai/chat-types'
import { SimulatedChatTransport } from '@renderer/lib/ai/simulated-chat-transport'

const EMPTY_MESSAGES: MicoUIMessage[] = []

type ChatWorkspace = {
  conversations: Conversation[]
  activeConversation: Conversation | null
  activeMessages: MicoUIMessage[]
  response: ChatResponseState
  composerFocusKey: number
  startNewChat: () => void
  selectConversation: (conversationId: string, options?: { focusComposer?: boolean }) => void
  renameConversation: (conversationId: string, title: string) => void
  deleteConversation: (conversationId: string) => void
  sendMessage: (content: string) => void
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

function useChatWorkspaceState(): ChatWorkspace {
  const sessionsRef = React.useRef(new Map<string, ChatSession>())
  const [conversations, setConversations] = React.useState<Conversation[]>([])
  const [activeSession, setActiveSession] = React.useState<ActiveChatSession | null>(null)
  const [response, setResponse] = React.useState<ChatResponseState>(IDLE_CHAT_RESPONSE)
  const responseRef = React.useRef<ChatResponseState>(IDLE_CHAT_RESPONSE)
  const [composerFocusKey, setComposerFocusKey] = React.useState(0)
  const [idleChat] = React.useState(
    () =>
      new Chat<MicoUIMessage>({
        id: 'empty-chat',
        transport: new SimulatedChatTransport()
      })
  )

  const setResponseState = React.useCallback((next: ChatResponseState): void => {
    responseRef.current = next
    setResponse(next)
  }, [])

  const settleResponse = React.useCallback(
    (conversationId: string): void => {
      if (
        responseRef.current.status !== 'idle' &&
        responseRef.current.conversationId === conversationId
      ) {
        setResponseState(IDLE_CHAT_RESPONSE)
      }
    },
    [setResponseState]
  )

  const createSession = React.useCallback(
    (conversation: Conversation): ChatSession => {
      const chat = new Chat<MicoUIMessage>({
        id: conversation.id,
        transport: new SimulatedChatTransport(),
        onFinish: () => settleResponse(conversation.id),
        onError: () => settleResponse(conversation.id)
      })

      const session = { conversation, chat }
      sessionsRef.current.set(conversation.id, session)
      return session
    },
    [settleResponse]
  )

  const subscribedChat = activeSession?.chat ?? idleChat
  const { messages: subscribedMessages, status: subscribedStatus } = useChat<MicoUIMessage>({
    chat: subscribedChat
  })
  const activeMessages = activeSession ? subscribedMessages : EMPTY_MESSAGES

  React.useEffect(() => {
    const currentResponse = responseRef.current

    if (
      activeSession &&
      currentResponse.status !== 'idle' &&
      currentResponse.conversationId === activeSession.conversationId &&
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
    setComposerFocusKey((key) => key + 1)
  }, [])

  const selectConversation = React.useCallback(
    (conversationId: string, { focusComposer = true }: { focusComposer?: boolean } = {}): void => {
      const session = sessionsRef.current.get(conversationId)
      if (!session) return

      setActiveSession({ conversationId, chat: session.chat })
      if (focusComposer) setComposerFocusKey((key) => key + 1)
    },
    []
  )

  const renameConversation = React.useCallback((conversationId: string, title: string): void => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle || !sessionsRef.current.has(conversationId)) return

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, title: trimmedTitle } : conversation
      )
    )

    const session = sessionsRef.current.get(conversationId)
    if (session) session.conversation = { ...session.conversation, title: trimmedTitle }
  }, [])

  const deleteConversation = React.useCallback(
    (conversationId: string): void => {
      const session = sessionsRef.current.get(conversationId)
      if (!session) return

      const currentResponse = responseRef.current
      if (currentResponse.status !== 'idle' && currentResponse.conversationId === conversationId) {
        void session.chat.stop()
        setResponseState(IDLE_CHAT_RESPONSE)
      }

      sessionsRef.current.delete(conversationId)
      setConversations((current) =>
        current.filter((conversation) => conversation.id !== conversationId)
      )
      setActiveSession((current) => (current?.conversationId === conversationId ? null : current))
    },
    [setResponseState]
  )

  const sendMessage = React.useCallback(
    (content: string): void => {
      if (!content.trim() || responseRef.current.status !== 'idle') return

      let session = activeSession
        ? sessionsRef.current.get(activeSession.conversationId)
        : undefined

      if (!session) {
        const conversation = { id: crypto.randomUUID(), title: 'New chat' }
        session = createSession(conversation)
        setConversations((current) => [...current, conversation])
        setActiveSession({ conversationId: conversation.id, chat: session.chat })
      }

      setResponseState({ status: 'submitted', conversationId: session.conversation.id })
      void session.chat.sendMessage({ text: content })
    },
    [activeSession, createSession, setResponseState]
  )

  const stopResponse = React.useCallback((): void => {
    const currentResponse = responseRef.current
    if (
      currentResponse.status === 'idle' ||
      currentResponse.conversationId !== activeSession?.conversationId
    ) {
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

  React.useEffect(
    () => () => {
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

  return React.useMemo(
    () => ({
      conversations,
      activeConversation,
      activeMessages,
      response,
      composerFocusKey,
      startNewChat,
      selectConversation,
      renameConversation,
      deleteConversation,
      sendMessage,
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
      selectConversation,
      sendMessage,
      startNewChat,
      stopResponse
    ]
  )
}

export { useChatWorkspaceState, type ChatWorkspace }
