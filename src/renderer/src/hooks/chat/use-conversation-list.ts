import * as React from 'react'

import type { Conversation } from '@renderer/types/chat'

type ConversationListStore = {
  conversations: Conversation[]
  /** Adopts the persisted list the first time it loads, without clobbering newer state. */
  seedConversations: (loaded: Conversation[]) => void
  addConversation: (conversation: Conversation) => void
  removeConversation: (conversationId: string) => void
  touchConversationActivity: (conversationId: string, at: number) => void
  applyConversationTitle: (conversationId: string, title: string) => void
}

/** Owns the workspace's conversation list: bootstrap, ordering metadata, and title updates. */
function useConversationList(): ConversationListStore {
  const [conversations, setConversations] = React.useState<Conversation[]>([])

  const seedConversations = React.useCallback((loaded: Conversation[]): void => {
    setConversations((current) => (current.length ? current : loaded))
  }, [])

  const addConversation = React.useCallback((conversation: Conversation): void => {
    setConversations((current) => [...current, conversation])
  }, [])

  const removeConversation = React.useCallback((conversationId: string): void => {
    setConversations((current) =>
      current.filter((conversation) => conversation.id !== conversationId)
    )
  }, [])

  const touchConversationActivity = React.useCallback(
    (conversationId: string, at: number): void => {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, lastActivityAt: at }
            : conversation
        )
      )
    },
    []
  )

  const applyConversationTitle = React.useCallback(
    (conversationId: string, title: string): void => {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, title } : conversation
        )
      )
    },
    []
  )

  React.useEffect(() => {
    let active = true

    void window.api.sessions.list().then(
      (sessions) => {
        if (!active) return

        seedConversations(
          sessions.map(({ id, title, projectId, cwd, lastActivityAt }) => ({
            id,
            title,
            projectId,
            cwd,
            lastActivityAt
          }))
        )
      },
      () => {
        if (active) setConversations([])
      }
    )

    return () => {
      active = false
    }
  }, [seedConversations])

  return {
    conversations,
    seedConversations,
    addConversation,
    removeConversation,
    touchConversationActivity,
    applyConversationTitle
  }
}

export { useConversationList, type ConversationListStore }
