import { Chat, useChat } from '@ai-sdk/react'
import * as React from 'react'

import {
  IDLE_CHAT_RESPONSE,
  type ChatResponseState,
  type Conversation,
  type MicoUIMessage
} from '@renderer/types/chat'
import { ElectronChatTransport } from '@renderer/services/ai-transport/electron-chat-transport'
import type { ModelReasoningCapabilities, ThinkingSelection } from '@shared/data/schemas/chat'

const EMPTY_MESSAGES: MicoUIMessage[] = []

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

function useChatWorkspaceState(): ChatWorkspace {
  // Keep sessions alive across selection changes so background responses can continue.
  const sessionsRef = React.useRef(new Map<string, ChatSession>())
  const [conversations, setConversations] = React.useState<Conversation[]>([])
  const [activeSession, setActiveSession] = React.useState<ActiveChatSession | null>(null)
  const [response, setResponse] = React.useState<ChatResponseState>(IDLE_CHAT_RESPONSE)
  const [reasoningCapabilities, setReasoningCapabilities] =
    React.useState<ModelReasoningCapabilities | null>(null)
  const [thinkingEffort, setThinkingEffortState] = React.useState<ThinkingSelection>('default')
  const [thinkingEffortStore] = React.useState(() => new ThinkingEffortStore())
  const getThinkingEffort = React.useCallback(
    () => thinkingEffortStore.get(),
    [thinkingEffortStore]
  )
  // Response actions can run before React commits, so they need the latest synchronous value.
  const responseRef = React.useRef<ChatResponseState>(IDLE_CHAT_RESPONSE)
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
        transport: new ElectronChatTransport(window.api.chat, {
          conversationId: conversation.id,
          getThinkingEffort,
          onStatusChange: (status) => {
            const currentResponse = responseRef.current
            if (
              currentResponse.status === 'idle' ||
              currentResponse.status === 'error' ||
              currentResponse.conversationId !== conversation.id
            ) {
              return
            }

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
    chat: subscribedChat
  })
  const activeMessages = activeSession ? subscribedMessages : EMPTY_MESSAGES

  // Do not let a newly selected session inherit the status of another conversation's response.
  React.useEffect(() => {
    const currentResponse = responseRef.current

    if (
      activeSession &&
      (currentResponse.status === 'submitted' || currentResponse.status === 'streaming') &&
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
    // A new token requests focus without coupling the workspace to the textarea ref.
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
      if (
        !content.trim() ||
        responseRef.current.status === 'submitted' ||
        responseRef.current.status === 'streaming' ||
        responseRef.current.status === 'retrying'
      ) {
        return
      }

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

  const retryResponse = React.useCallback((): void => {
    const currentResponse = responseRef.current
    if (
      currentResponse.status !== 'error' ||
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

  return React.useMemo(
    () => ({
      conversations,
      activeConversation,
      activeMessages,
      response,
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
