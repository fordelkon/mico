import type { ChatMessage, ChatStartRequest, ChatStreamEvent } from '@shared/data/schemas/chat'
import type { UIMessageChunk } from 'ai'

import { describeChatError } from './chat-error'

type ChatStreamFactory = (
  messages: ChatMessage[],
  signal: AbortSignal
) => Promise<AsyncIterable<UIMessageChunk>>

type ChatRun = {
  controller: AbortController
  ownerId: string
}

type ChatRetryOptions = {
  maxAttempts?: number
  retryDelayMs?: number
}

const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_RETRY_DELAY_MS = 1_000

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || delayMs === 0) return Promise.resolve()

  return new Promise((resolve) => {
    const timeoutId = setTimeout(resolve, delayMs)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeoutId)
        resolve()
      },
      { once: true }
    )
  })
}

class ChatService {
  private readonly runs = new Map<string, ChatRun>()
  private readonly maxAttempts: number
  private readonly retryDelayMs: number

  constructor(
    private readonly createStream: ChatStreamFactory,
    {
      maxAttempts = DEFAULT_MAX_ATTEMPTS,
      retryDelayMs = DEFAULT_RETRY_DELAY_MS
    }: ChatRetryOptions = {}
  ) {
    this.maxAttempts = maxAttempts
    this.retryDelayMs = retryDelayMs
  }

  start(
    { ownerId, request }: { ownerId: string; request: ChatStartRequest },
    emit: (event: ChatStreamEvent) => void
  ): void {
    this.abort({ ownerId, requestId: request.requestId })

    const key = this.getRunKey(ownerId, request.requestId)
    const run = { controller: new AbortController(), ownerId }
    this.runs.set(key, run)
    void this.consume({ key, request, run, emit })
  }

  abort({ ownerId, requestId }: { ownerId: string; requestId: string }): void {
    this.runs.get(this.getRunKey(ownerId, requestId))?.controller.abort()
  }

  abortAll(ownerId: string): void {
    for (const run of this.runs.values()) {
      if (run.ownerId === ownerId) run.controller.abort()
    }
  }

  dispose(): void {
    for (const run of this.runs.values()) {
      run.controller.abort()
    }
  }

  private async consume({
    key,
    request,
    run,
    emit
  }: {
    key: string
    request: ChatStartRequest
    run: ChatRun
    emit: (event: ChatStreamEvent) => void
  }): Promise<void> {
    let receivedChunk = false

    try {
      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        try {
          const stream = await this.createStream(request.messages, run.controller.signal)
          for await (const chunk of stream) {
            if (!run.controller.signal.aborted) {
              receivedChunk = true
              emit({ type: 'chunk', requestId: request.requestId, chunk })
            }
          }

          if (!run.controller.signal.aborted) {
            emit({ type: 'finish', requestId: request.requestId })
          }
          return
        } catch (error) {
          const providerError =
            error instanceof Error ? error : new Error('Unknown chat provider error')
          const canRetry =
            !run.controller.signal.aborted &&
            !receivedChunk &&
            attempt < this.maxAttempts &&
            describeChatError(providerError).retryable

          if (!canRetry) throw providerError

          const retryDelayMs = this.retryDelayMs * 2 ** (attempt - 1)
          emit({
            type: 'retry',
            requestId: request.requestId,
            attempt: attempt + 1,
            maxAttempts: this.maxAttempts,
            retryDelayMs
          })
          await waitForRetry(retryDelayMs, run.controller.signal)
        }
      }
    } catch (error) {
      if (!run.controller.signal.aborted) {
        emit({
          type: 'error',
          requestId: request.requestId,
          message: describeChatError(
            error instanceof Error ? error : new Error('Unknown chat provider error')
          ).message
        })
      }
    } finally {
      if (this.runs.get(key) === run) this.runs.delete(key)
    }
  }

  private getRunKey(ownerId: string, requestId: string): string {
    return `${ownerId.length}:${ownerId}${requestId}`
  }
}

export { ChatService, type ChatStreamFactory }
