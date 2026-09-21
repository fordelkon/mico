import { Chat } from '@ai-sdk/react'
import * as React from 'react'

import { ElectronChatTransport } from '@renderer/services/ai-transport/electron-chat-transport'
import type { Conversation, MicoUIMessage } from '@renderer/types/chat'
import type { ChatMessage, ThinkingSelection } from '@shared/data/schemas/chat'
import type { WorkspaceProject } from '@shared/data/schemas/workspace'

import type { ChatResponseUpdate } from './chat-response-store'

type ChatSession = {
  conversation: Conversation
  chat: Chat<MicoUIMessage>
  modelEntryId: string | null
  thinkingEffort: ThinkingSelection | null
  project: WorkspaceProject | null
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

type ChatSessionsStore = {
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
  getResponse: (conversationId: string) => ChatResponseUpdate | undefined
  onResponseState: (next: ChatResponseUpdate) => void
  onResponseSettled: (conversationId: string) => void
}): ChatSessionsStore {
  const { getThinkingEffort, getResponse, onResponseState, onResponseSettled } = options
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

      const session = { conversation, chat, project, ...selection }
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

  return { getSession, removeSession, createSession, updateSession }
}

export { useChatSessions, type ChatSession, type ChatSessionsStore }
