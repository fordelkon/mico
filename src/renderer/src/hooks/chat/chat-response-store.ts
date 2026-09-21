import * as React from 'react'

import { isActiveChatResponse, type ChatResponseState } from '@renderer/types/chat'

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

export { useChatResponses, type ChatResponseUpdate, type ChatResponsesStore }
