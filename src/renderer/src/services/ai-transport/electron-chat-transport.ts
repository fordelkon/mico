import type { MicoUIMessage } from '@renderer/types/chat'
import type { ContextMeasurement } from '@shared/ai/context-measurement'
import type { PermissionMode } from '@shared/ai/permissions'
import type { ChatUserMessage, ThinkingSelection } from '@shared/data/schemas/chat'
import type { ChatAPI, TurnStartRequest } from '@shared/ipc/schemas/chat'
import type { ChatTransport, UIMessageChunk } from 'ai'

function toLatestUserMessage(messages: MicoUIMessage[]): ChatUserMessage {
  const message = messages.findLast(({ role }) => role === 'user')
  if (!message) throw new Error('Chat request must include a user message.')

  const parts: ChatUserMessage['parts'] = []
  for (const part of message.parts) {
    if (part.type === 'data-document') parts.push(part.data)
    if (part.type === 'data-skill-invocation') parts.push({ type: part.type, data: part.data })
    if (part.type === 'text' && part.text.trim()) parts.push({ type: 'text', text: part.text })
    if (part.type === 'reasoning' && part.text) {
      const reasoningPart: ChatUserMessage['parts'][number] = {
        type: 'reasoning',
        text: part.text
      }
      if (part.providerMetadata) reasoningPart.providerMetadata = part.providerMetadata
      parts.push(reasoningPart)
    }
  }
  if (!parts.length) throw new Error('Chat request must include message content.')

  const userMessage: ChatUserMessage = { role: 'user', parts }
  if (message.metadata?.providerMetadata)
    userMessage.providerMetadata = message.metadata.providerMetadata
  return userMessage
}

type TurnTransportStatus =
  | { type: 'retrying'; attempt: number; maxAttempts: number; retryDelayMs: number }
  | { type: 'streaming' }

type ElectronChatTransportOptions = {
  sessionId: string
  getThinkingEffort: () => ThinkingSelection
  getPermissionMode?: () => PermissionMode
  getRetryRunId?: () => string | undefined
  onStatusChange?: (status: TurnTransportStatus) => void
  onContextMeasurement?: (measurement: ContextMeasurement) => void
}

const TEXT_DELTA_BATCH_DELAY_MS = 16
const TEXT_DELTA_BATCH_MAX_CHARS = 4 * 1024

class ElectronChatTransport implements ChatTransport<MicoUIMessage> {
  #cancellation: Promise<void> = Promise.resolve()
  #cancelledRequestId: string | undefined
  readonly #api: ChatAPI
  readonly #sessionId: string
  readonly #getThinkingEffort: () => ThinkingSelection
  readonly #getPermissionMode: () => PermissionMode
  readonly #getRetryRunId: () => string | undefined
  readonly #onStatusChange?: ElectronChatTransportOptions['onStatusChange']
  readonly #onContextMeasurement?: ElectronChatTransportOptions['onContextMeasurement']

  constructor(
    api: ChatAPI,
    {
      sessionId,
      getThinkingEffort,
      getPermissionMode = () => 'default',
      getRetryRunId = () => undefined,
      onStatusChange,
      onContextMeasurement
    }: ElectronChatTransportOptions
  ) {
    this.#api = api
    this.#sessionId = sessionId
    this.#getThinkingEffort = getThinkingEffort
    this.#getPermissionMode = getPermissionMode
    this.#getRetryRunId = getRetryRunId
    this.#onStatusChange = onStatusChange
    this.#onContextMeasurement = onContextMeasurement
  }

  async retryCancellation(): Promise<void> {
    if (this.#cancelledRequestId) this.#cancellation = this.#api.abortTurn(this.#cancelledRequestId)
    await this.#cancellation
  }

  async awaitCancellation(): Promise<void> {
    await this.#cancellation
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }

  async sendMessages(
    options: Parameters<ChatTransport<MicoUIMessage>['sendMessages']>[0]
  ): Promise<ReadableStream<UIMessageChunk>> {
    const requestId = crypto.randomUUID()
    const thinkingEffort = this.#getThinkingEffort()
    const permissionMode = this.#getPermissionMode()
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
        const unsubscribe = this.#api.onTurnEvent((event) => {
          if (!active || event.requestId !== requestId) return

          if (event.type === 'context-measurement') {
            this.#onContextMeasurement?.(event.measurement)
            return
          }
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
          switch (event.type) {
            case 'error':
              controller.error(new Error(event.message))
              return
            case 'cancelled':
            case 'finish':
              controller.close()
          }
        })
        const abort = (): void => {
          if (!active) return

          clearPendingTextDelta()
          stop?.()
          this.#cancelledRequestId = requestId
          this.#cancellation = this.#api.abortTurn(requestId)
          void this.#cancellation.catch(() => undefined)
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
          const request: TurnStartRequest = {
            sessionId: this.#sessionId,
            requestId,
            userMessage: toLatestUserMessage(options.messages),
            thinkingEffort,
            permissionMode
          }
          if (options.trigger === 'regenerate-message') {
            const retryRunId = this.#getRetryRunId()
            if (!retryRunId) {
              stop?.()
              controller.error(
                new Error(
                  'Recovery details are unavailable. Reopen this conversation before retrying.'
                )
              )
              return
            }
            request.retry = true
            request.retryRunId = retryRunId
          }
          void this.#api.startTurn(request).catch(() => {
            if (!active) return

            stop?.()
            controller.error(new Error('Unable to start chat. Please try again.'))
          })
        }
      }
    })
  }
}

export { ElectronChatTransport, type TurnTransportStatus }
