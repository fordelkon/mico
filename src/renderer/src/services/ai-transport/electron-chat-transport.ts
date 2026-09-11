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

const TEXT_DELTA_BATCH_DELAY_MS = 16
const TEXT_DELTA_BATCH_MAX_CHARS = 4 * 1024

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
        let pendingTextDelta: Extract<UIMessageChunk, { type: 'text-delta' }> | undefined
        let flushTimer: ReturnType<typeof setTimeout> | undefined
        const clearPendingTextDelta = (): void => {
          // A cancelled stream has no consumer, so retaining its batch only prolongs its lifetime.
          if (flushTimer) clearTimeout(flushTimer)
          flushTimer = undefined
          pendingTextDelta = undefined
        }
        const flushPendingTextDelta = (): void => {
          if (flushTimer) clearTimeout(flushTimer)
          flushTimer = undefined
          if (!active || !pendingTextDelta) return

          controller.enqueue(pendingTextDelta)
          pendingTextDelta = undefined
        }
        const enqueueTextDelta = (chunk: Extract<UIMessageChunk, { type: 'text-delta' }>): void => {
          let remainingDelta = chunk.delta
          while (remainingDelta) {
            if (pendingTextDelta && pendingTextDelta.id !== chunk.id) flushPendingTextDelta()

            const pendingLength = pendingTextDelta?.delta.length ?? 0
            const deltaLength = Math.min(
              TEXT_DELTA_BATCH_MAX_CHARS - pendingLength,
              remainingDelta.length
            )
            const delta = remainingDelta.slice(0, deltaLength)
            remainingDelta = remainingDelta.slice(deltaLength)

            pendingTextDelta = pendingTextDelta
              ? { ...pendingTextDelta, delta: pendingTextDelta.delta + delta }
              : { ...chunk, delta }

            if (pendingTextDelta.delta.length === TEXT_DELTA_BATCH_MAX_CHARS)
              flushPendingTextDelta()
            else if (!flushTimer)
              flushTimer = setTimeout(flushPendingTextDelta, TEXT_DELTA_BATCH_DELAY_MS)
          }
        }
        const enqueueChunk = (chunk: UIMessageChunk): void => {
          if (chunk.type !== 'text-delta') {
            flushPendingTextDelta()
            controller.enqueue(chunk)
            return
          }

          enqueueTextDelta(chunk)
        }
        const unsubscribe = this.#api.onEvent((event) => {
          if (!active || event.requestId !== requestId) return

          if (event.type === 'chunk') {
            this.#onStatusChange?.({ type: 'streaming' })
            enqueueChunk(event.chunk)
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

          // Terminal events must not discard the last batched text delta.
          flushPendingTextDelta()
          stop?.()
          if (event.type === 'error') controller.error(new Error(event.message))
          else controller.close()
        })
        const abort = (): void => {
          if (!active) return

          clearPendingTextDelta()
          stop?.()
          void this.#api.abort(requestId)
          controller.close()
        }

        stop = (): void => {
          if (!active) return

          active = false
          clearPendingTextDelta()
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
