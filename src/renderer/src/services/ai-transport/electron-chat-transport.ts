import type { ChatTransport, UIMessageChunk } from 'ai'

import type { ChatMessage, ThinkingSelection } from '@shared/data/schemas/chat'
import type { ChatAPI } from '@shared/ipc/schemas/chat'
import type { MicoUIMessage } from '@renderer/types/chat'

function toChatMessages(messages: MicoUIMessage[]): ChatMessage[] {
  return messages.flatMap((message) => {
    const parts: ChatMessage['parts'] = []
    for (const part of message.parts) {
      if (part.type === 'text' && part.text.trim()) parts.push({ type: 'text', text: part.text })
      if (part.type === 'reasoning' && part.text) {
        const reasoningPart: ChatMessage['parts'][number] = { type: 'reasoning', text: part.text }
        if (part.providerMetadata) reasoningPart.providerMetadata = part.providerMetadata
        parts.push(reasoningPart)
      }
    }
    if (!parts.length) return []
    const chatMessage: ChatMessage = { role: message.role, parts }
    if (message.metadata?.providerMetadata)
      chatMessage.providerMetadata = message.metadata.providerMetadata
    return [chatMessage]
  })
}

type ChatTransportStatus =
  | { type: 'retrying'; attempt: number; maxAttempts: number; retryDelayMs: number }
  | { type: 'streaming' }

type ElectronChatTransportOptions = {
  conversationId: string
  getThinkingEffort: () => ThinkingSelection
  onStatusChange?: (status: ChatTransportStatus) => void
}

class ElectronChatTransport implements ChatTransport<MicoUIMessage> {
  readonly #api: ChatAPI
  readonly #conversationId: string
  readonly #getThinkingEffort: () => ThinkingSelection
  readonly #onStatusChange?: ElectronChatTransportOptions['onStatusChange']

  constructor(
    api: ChatAPI,
    { conversationId, getThinkingEffort, onStatusChange }: ElectronChatTransportOptions
  ) {
    this.#api = api
    this.#conversationId = conversationId
    this.#getThinkingEffort = getThinkingEffort
    this.#onStatusChange = onStatusChange
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }

  async sendMessages(
    options: Parameters<ChatTransport<MicoUIMessage>['sendMessages']>[0]
  ): Promise<ReadableStream<UIMessageChunk>> {
    const requestId = crypto.randomUUID()
    const thinkingEffort = this.#getThinkingEffort()
    let stop: (() => void) | undefined

    return new ReadableStream<UIMessageChunk>({
      cancel: () => stop?.(),
      start: (controller) => {
        let active = true
        const unsubscribe = this.#api.onEvent((event) => {
          if (!active || event.requestId !== requestId) return

          if (event.type === 'chunk') {
            this.#onStatusChange?.({ type: 'streaming' })
            controller.enqueue(event.chunk)
            return
          }

          if (event.type === 'retry') {
            this.#onStatusChange?.({
              type: 'retrying',
              attempt: event.attempt,
              maxAttempts: event.maxAttempts,
              retryDelayMs: event.retryDelayMs
            })
            return
          }

          stop?.()
          if (event.type === 'error') controller.error(new Error(event.message))
          else controller.close()
        })
        const abort = (): void => {
          if (!active) return

          stop?.()
          void this.#api.abort(requestId)
          controller.close()
        }

        stop = (): void => {
          if (!active) return

          active = false
          options.abortSignal?.removeEventListener('abort', abort)
          unsubscribe()
        }

        options.abortSignal?.addEventListener('abort', abort, { once: true })
        if (options.abortSignal?.aborted) abort()
        else {
          void this.#api
            .start({
              conversationId: this.#conversationId,
              requestId,
              messages: toChatMessages(options.messages),
              thinkingEffort
            })
            .catch(() => {
              if (!active) return

              stop?.()
              controller.error(new Error('Unable to start chat. Please try again.'))
            })
        }
      }
    })
  }
}

export { ElectronChatTransport, type ChatTransportStatus }
