import { createHash } from 'node:crypto'

import type { ChatProvider, ChatProviderConfiguration } from '@mico/ai-providers'
import type { ChatStartRequest, ChatStreamEvent } from '@shared/data/schemas/chat'

import { describeChatError } from './chat-error'
import type { ChatProviderResolver } from './chat-provider-resolver'
import {
  SessionRuntimeService,
  type ExecutionProfileSnapshot
} from '../sessions/session-runtime-service'

type ChatRun = {
  controller: AbortController
  ownerId: string
  runId?: string
}

type ChatServiceOptions = {
  getSelectedChatConfiguration?: () => ChatProviderConfiguration | null
  maxAssistantTextChars?: number
  maxAttempts?: number
  retryDelayMs?: number
  runtime?: Pick<
    SessionRuntimeService,
    | 'cancelRun'
    | 'failRun'
    | 'finalizeRun'
    | 'getContextMessages'
    | 'markRequestStarted'
    | 'startTurn'
  >
}

const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_RETRY_DELAY_MS = 1_000
// The same ceiling must bound persisted text and renderer deltas so either process cannot grow alone.
const DEFAULT_MAX_ASSISTANT_TEXT_CHARS = 256 * 1024
const TRUNCATION_MARKER = '…'

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
  private readonly maxAssistantTextChars: number
  private readonly retryDelayMs: number

  private readonly resolveProvider: ChatProviderResolver

  constructor(
    resolveProvider: ChatProviderResolver,
    {
      maxAttempts = DEFAULT_MAX_ATTEMPTS,
      maxAssistantTextChars = DEFAULT_MAX_ASSISTANT_TEXT_CHARS,
      retryDelayMs = DEFAULT_RETRY_DELAY_MS,
      runtime,
      getSelectedChatConfiguration
    }: ChatServiceOptions = {}
  ) {
    this.resolveProvider = resolveProvider
    this.maxAttempts = maxAttempts
    this.maxAssistantTextChars = maxAssistantTextChars
    this.retryDelayMs = retryDelayMs
    this.runtime = runtime
    this.getSelectedChatConfiguration = getSelectedChatConfiguration
  }

  private readonly runtime: ChatServiceOptions['runtime']
  private readonly getSelectedChatConfiguration: ChatServiceOptions['getSelectedChatConfiguration']

  getModelCapabilities(): ReturnType<ChatProvider['getModelCapabilities']> {
    return this.resolveProvider()?.getModelCapabilities() ?? Promise.resolve(null)
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
    const run = this.runs.get(this.getRunKey(ownerId, requestId))
    run?.controller.abort()
    if (run?.runId) this.runtime?.cancelRun(run.runId)
  }

  abortAll(ownerId: string): void {
    for (const run of this.runs.values()) {
      if (run.ownerId === ownerId) {
        run.controller.abort()
        if (run.runId) this.runtime?.cancelRun(run.runId)
      }
    }
  }

  dispose(): void {
    for (const run of this.runs.values()) {
      run.controller.abort()
      if (run.runId) this.runtime?.cancelRun(run.runId)
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
    let assistantText = ''

    try {
      const provider = this.resolveProvider()
      if (!provider) throw new Error('Select an enabled model in Settings before chatting.')

      if (this.runtime) {
        const configuration = this.getSelectedChatConfiguration?.()
        if (!configuration) throw new Error('Select an enabled model in Settings before chatting.')
        const started = this.runtime.startTurn({
          sessionId: request.conversationId,
          requestId: request.requestId,
          userMessage: getLatestUserMessage(request.messages),
          profile: toExecutionProfile(configuration, request.thinkingEffort ?? 'default')
        })
        run.runId = started.runId
        this.runtime.markRequestStarted(started.runId)
      }

      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        try {
          const stream = await provider.stream({
            conversationKey: `${run.ownerId}:${request.conversationId}`,
            messages: run.runId
              ? (this.runtime?.getContextMessages(run.runId) ?? request.messages)
              : request.messages,
            thinkingEffort: request.thinkingEffort ?? 'default',
            signal: run.controller.signal
          })
          for await (const chunk of stream) {
            if (!run.controller.signal.aborted) {
              receivedChunk = true
              if (chunk.type === 'text-delta') {
                const previousText = assistantText
                assistantText = appendCappedText(
                  assistantText,
                  chunk.delta,
                  this.maxAssistantTextChars
                )
                const visibleDelta = assistantText.slice(previousText.length)
                if (visibleDelta) {
                  emit({
                    type: 'chunk',
                    requestId: request.requestId,
                    chunk: { ...chunk, delta: visibleDelta }
                  })
                }
              } else {
                emit({ type: 'chunk', requestId: request.requestId, chunk })
              }
            }
          }

          if (!run.controller.signal.aborted) {
            if (run.runId) {
              this.runtime?.finalizeRun(run.runId, {
                role: 'assistant',
                parts: [{ type: 'text', text: assistantText }]
              })
            }
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
        if (run.runId) {
          const described = describeChatError(
            error instanceof Error ? error : new Error('Unknown chat provider error')
          )
          this.runtime?.failRun(run.runId, { code: 'provider_error', message: described.message })
        }
        emit({
          type: 'error',
          requestId: request.requestId,
          message: describeChatError(
            error instanceof Error ? error : new Error('Unknown chat provider error')
          ).message
        })
      }
    } finally {
      if (run.controller.signal.aborted && run.runId) this.runtime?.cancelRun(run.runId)
      if (this.runs.get(key) === run) this.runs.delete(key)
    }
  }

  private getRunKey(ownerId: string, requestId: string): string {
    return `${ownerId.length}:${ownerId}${requestId}`
  }
}

function appendCappedText(current: string, delta: string, maxLength: number): string {
  if (current.endsWith(TRUNCATION_MARKER)) return current
  if (current.length + delta.length <= maxLength) return current + delta

  const contentLength = Math.max(0, maxLength - TRUNCATION_MARKER.length)
  const visibleText =
    current.length >= contentLength
      ? current.slice(0, contentLength)
      : current + delta.slice(0, contentLength - current.length)
  return `${visibleText}${TRUNCATION_MARKER}`
}

function getLatestUserMessage(
  messages: ChatStartRequest['messages']
): ChatStartRequest['messages'][number] {
  const message = [...messages].reverse().find(({ role }) => role === 'user')
  if (!message) throw new Error('Chat request must include a user message.')
  return message
}

function toExecutionProfile(
  configuration: ChatProviderConfiguration,
  thinkingEffort: ExecutionProfileSnapshot['thinkingEffort']
): ExecutionProfileSnapshot {
  const safeConfiguration = { ...configuration }
  if ('apiKey' in safeConfiguration) delete safeConfiguration.apiKey
  return {
    providerId: configuration.provider,
    modelId: configuration.modelId,
    thinkingEffort,
    configurationDigest: createHash('sha256')
      .update(JSON.stringify(safeConfiguration))
      .digest('hex')
  }
}

export { ChatService }
