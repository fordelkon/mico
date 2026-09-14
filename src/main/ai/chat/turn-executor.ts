import { createHash } from 'node:crypto'

import type { ChatProvider, ChatProviderConfiguration } from '@mico/ai-providers'
import type { TurnStartRequest, TurnStreamEvent, TurnTerminalEvent } from '@shared/ipc/schemas/chat'

import { describeChatError } from './chat-error'
import type { ChatProviderResolver } from './chat-provider-resolver'
import type {
  ExecutionProfileSnapshot,
  SessionRuntimeService
} from '../sessions/session-runtime-service'

type ActiveTurn = {
  assistantTextBuilder: CappedTextBuilder
  controller: AbortController
  emit: (event: TurnStreamEvent) => void
  ownerId: string
  requestId: string
  runId?: string
  terminal: boolean
}

type SessionTitleUpdate = { sessionId: string; title: string }

type TurnExecutorOptions = {
  getSelectedChatConfiguration?: () => ChatProviderConfiguration | null
  maxAssistantTextChars?: number
  maxAttempts?: number
  retryDelayMs?: number
  runtime?: Pick<
    SessionRuntimeService,
    | 'finishRun'
    | 'getContextMessages'
    | 'markRequestStarted'
    | 'renameSessionIfCurrentTitle'
    | 'retryTurn'
    | 'startTurn'
  >
}

const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_RETRY_DELAY_MS = 1_000
// The same ceiling must bound persisted text and renderer deltas so either process cannot grow alone.
const DEFAULT_MAX_ASSISTANT_TEXT_CHARS = 256 * 1024
const DEFAULT_SESSION_TITLE = 'New chat'
const MAX_SESSION_TITLE_CHARS = 50
const SESSION_TITLE_INSTRUCTIONS = `You are a conversation title generator.

Your ONLY task is to generate a concise, descriptive title for the conversation.
Output ONLY the title. Do not answer the user's request and do not include explanations.

<goal>
Generate a title that helps the user quickly recognize this conversation in a session list, distinguish it from similar conversations, and find it again through search.
</goal>

<output_rules>
- Output exactly one title on one line only.
- Do not use quotation marks, Markdown, a label such as "Title:", or trailing punctuation unless it is part of a technical identifier.
- Keep the title concise: prefer 3–8 English words or roughly 8–20 Chinese characters, with a hard limit of 50 characters whenever possible.
</output_rules>

<language>
- Use the same primary language as the user's request.
- Preserve technical terms in their conventional form. Do not unnecessarily translate library names, APIs, filenames, commands, model names, or product names.
</language>

<title_content>
Capture the user's actual goal rather than merely repeating the beginning of their message. Prefer the primary subject plus its operation, problem, or goal. Preserve details that make the conversation distinguishable and easy to find again, including important product names, technical concepts, files, components, libraries, error codes, model names, and relevant versions.
</title_content>

<constraints>
- Infer the task at one level above the literal wording; remove conversational filler.
- Prefer precise action concepts such as 修复, 排查, 优化, 实现, 配置, 重构, 迁移, 集成, 部署, 调试, 分析, 比较, 设计, 研究, 安装, 升级, or 解释 when appropriate.
- If a file is mentioned, title the task involving it rather than the filename alone.
- Never invent technical details or combine unrelated topics. For multiple topics, use the dominant current task.
- Always generate a meaningful title, even for a short conversational input.
</constraints>`
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

class TurnExecutor {
  private readonly activeTurns = new Map<string, ActiveTurn>()
  private readonly titleGenerationSessions = new Set<string>()
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
    }: TurnExecutorOptions = {}
  ) {
    this.resolveProvider = resolveProvider
    this.maxAttempts = maxAttempts
    this.maxAssistantTextChars = maxAssistantTextChars
    this.retryDelayMs = retryDelayMs
    this.runtime = runtime
    this.getSelectedChatConfiguration = getSelectedChatConfiguration
  }

  private readonly runtime: TurnExecutorOptions['runtime']
  private readonly getSelectedChatConfiguration: TurnExecutorOptions['getSelectedChatConfiguration']

  getModelCapabilities(): ReturnType<ChatProvider['getModelCapabilities']> {
    return this.resolveProvider()?.getModelCapabilities() ?? Promise.resolve(null)
  }

  startTurn(
    { ownerId, request }: { ownerId: string; request: TurnStartRequest },
    emit: (event: TurnStreamEvent) => void,
    onTitleUpdated?: (update: SessionTitleUpdate) => void
  ): void {
    this.abortTurn({ ownerId, requestId: request.requestId })

    const key = this.getTurnKey(ownerId, request.requestId)
    const turn = {
      assistantTextBuilder: new CappedTextBuilder(this.maxAssistantTextChars),
      controller: new AbortController(),
      emit,
      ownerId,
      requestId: request.requestId,
      terminal: false
    }
    this.activeTurns.set(key, turn)
    void this.execute({ key, request, turn, emit, onTitleUpdated })
  }

  abortTurn({ ownerId, requestId }: { ownerId: string; requestId: string }): void {
    const turn = this.activeTurns.get(this.getTurnKey(ownerId, requestId))
    if (turn) this.cancelTurn(turn)
  }

  abortAllTurns(ownerId: string): void {
    for (const turn of this.activeTurns.values()) {
      if (turn.ownerId === ownerId) {
        this.cancelTurn(turn)
      }
    }
  }

  dispose(): void {
    for (const turn of this.activeTurns.values()) {
      this.cancelTurn(turn)
    }
  }

  private async execute({
    key,
    request,
    turn,
    emit,
    onTitleUpdated
  }: {
    key: string
    request: TurnStartRequest
    turn: ActiveTurn
    emit: (event: TurnStreamEvent) => void
    onTitleUpdated?: (update: SessionTitleUpdate) => void
  }): Promise<void> {
    let receivedChunk = false
    try {
      const provider = this.resolveProvider()
      if (!provider) throw new Error('Select an enabled model in Settings before chatting.')

      if (this.runtime) {
        const configuration = this.getSelectedChatConfiguration?.()
        if (!configuration) throw new Error('Select an enabled model in Settings before chatting.')
        const started = request.retry
          ? this.runtime.retryTurn({
              sessionId: request.sessionId,
              requestId: request.requestId,
              userMessage: request.userMessage
            })
          : this.runtime.startTurn({
              sessionId: request.sessionId,
              requestId: request.requestId,
              userMessage: request.userMessage,
              profile: toExecutionProfile(configuration, request.thinkingEffort ?? 'default')
            })
        turn.runId = started.runId
        this.runtime.markRequestStarted(started.runId)
        if (started.shouldGenerateTitle) {
          this.startTitleGeneration(
            provider,
            request.sessionId,
            getMessageText(request.userMessage),
            turn.controller.signal,
            onTitleUpdated
          )
        }
      }

      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        try {
          const stream = await provider.stream({
            conversationKey: `${turn.ownerId}:${request.sessionId}`,
            messages: turn.runId
              ? (this.runtime?.getContextMessages(turn.runId) ?? [request.userMessage])
              : [request.userMessage],
            thinkingEffort: request.thinkingEffort ?? 'default',
            signal: turn.controller.signal
          })
          for await (const chunk of stream) {
            if (!turn.controller.signal.aborted) {
              receivedChunk = true
              if (chunk.type === 'text-delta') {
                // Chunks append in O(delta); the full string is only materialized when read.
                const visibleDelta = turn.assistantTextBuilder.append(chunk.delta)
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

          if (!turn.controller.signal.aborted) {
            if (turn.runId) {
              this.runtime?.finishRun(turn.runId, {
                status: 'completed',
                assistant: {
                  role: 'assistant',
                  parts: [{ type: 'text', text: turn.assistantTextBuilder.toString() }]
                }
              })
            }
            this.emitTerminal(turn, { type: 'finish', requestId: request.requestId })
          }
          return
        } catch (error) {
          const providerError =
            error instanceof Error ? error : new Error('Unknown chat provider error')
          const canRetry =
            !turn.controller.signal.aborted &&
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
          await waitForRetry(retryDelayMs, turn.controller.signal)
        }
      }
    } catch (error) {
      if (!turn.controller.signal.aborted) {
        if (turn.runId) {
          const described = describeChatError(
            error instanceof Error ? error : new Error('Unknown chat provider error')
          )
          this.runtime?.finishRun(turn.runId, {
            status: 'failed',
            failure: { code: 'provider_error', message: described.message }
          })
        }
        this.emitTerminal(turn, {
          type: 'error',
          requestId: request.requestId,
          message: describeChatError(
            error instanceof Error ? error : new Error('Unknown chat provider error')
          ).message
        })
      }
    } finally {
      if (this.activeTurns.get(key) === turn) this.activeTurns.delete(key)
    }
  }

  private getTurnKey(ownerId: string, requestId: string): string {
    return `${ownerId.length}:${ownerId}${requestId}`
  }

  private cancelPersistedRun(turn: ActiveTurn): void {
    if (!turn.runId) return
    const text = turn.assistantTextBuilder.toString()
    if (!text) {
      this.runtime?.finishRun(turn.runId, { status: 'cancelled' })
      return
    }

    this.runtime?.finishRun(turn.runId, {
      status: 'cancelled',
      assistant: {
        role: 'assistant',
        parts: [{ type: 'text', text }],
        metadata: { completionState: 'stopped' }
      }
    })
  }

  private cancelTurn(turn: ActiveTurn): void {
    if (turn.terminal) return
    turn.controller.abort()
    this.cancelPersistedRun(turn)
    this.emitTerminal(turn, { type: 'cancelled', requestId: turn.requestId })
  }

  private emitTerminal(turn: ActiveTurn, event: TurnTerminalEvent): void {
    if (turn.terminal) return
    turn.terminal = true
    turn.emit(event)
  }

  private startTitleGeneration(
    provider: ChatProvider,
    sessionId: string,
    sourceText: string,
    signal: AbortSignal,
    onTitleUpdated?: (update: SessionTitleUpdate) => void
  ): void {
    if (!sourceText || !this.runtime || this.titleGenerationSessions.has(sessionId)) return

    this.titleGenerationSessions.add(sessionId)
    void this.generateTitle(provider, sessionId, sourceText, signal, onTitleUpdated).finally(() => {
      this.titleGenerationSessions.delete(sessionId)
    })
  }

  private async generateTitle(
    provider: ChatProvider,
    sessionId: string,
    sourceText: string,
    signal: AbortSignal,
    onTitleUpdated?: (update: SessionTitleUpdate) => void
  ): Promise<void> {
    try {
      const stream = await provider.stream({
        conversationKey: `title:${sessionId}`,
        messages: [
          { role: 'system', parts: [{ type: 'text', text: SESSION_TITLE_INSTRUCTIONS }] },
          { role: 'user', parts: [{ type: 'text', text: sourceText }] }
        ],
        thinkingEffort: 'none',
        signal
      })
      let generated = ''
      for await (const chunk of stream) {
        if (signal.aborted) return
        if (chunk.type === 'text-delta') generated += chunk.delta
      }
      const title = normalizeGeneratedTitle(generated)
      if (title && !signal.aborted) {
        const renamed = this.runtime?.renameSessionIfCurrentTitle(
          sessionId,
          DEFAULT_SESSION_TITLE,
          title
        )
        if (renamed) onTitleUpdated?.({ sessionId, title: renamed.title })
      }
    } catch {
      // Title generation is best-effort and must never affect the user-visible chat response.
    }
  }
}

/**
 * Accumulates streamed text up to `maxLength` characters without re-joining the
 * whole string on every delta. Once truncated, further deltas are dropped and
 * `append` returns an empty visible delta.
 */
class CappedTextBuilder {
  #chunks: string[] = []
  #length = 0
  #sealed = false
  readonly #maxLength: number

  constructor(maxLength: number) {
    this.#maxLength = maxLength
  }

  append(delta: string): string {
    if (this.#sealed) return ''

    if (this.#length + delta.length <= this.#maxLength) {
      this.#chunks.push(delta)
      this.#length += delta.length
      if (delta.endsWith(TRUNCATION_MARKER)) this.#sealed = true
      return delta
    }

    const contentLength = Math.max(0, this.#maxLength - TRUNCATION_MARKER.length)
    if (this.#length >= contentLength) {
      const previousLength = this.#length
      this.#truncate(contentLength)
      this.#chunks.push(TRUNCATION_MARKER)
      this.#length += TRUNCATION_MARKER.length
      this.#sealed = true
      return previousLength < this.#length
        ? TRUNCATION_MARKER.slice(previousLength - contentLength)
        : ''
    }

    const remaining = contentLength - this.#length
    const visibleText = delta.slice(0, remaining)
    this.#chunks.push(visibleText, TRUNCATION_MARKER)
    this.#length += visibleText.length + TRUNCATION_MARKER.length
    this.#sealed = true
    return visibleText + TRUNCATION_MARKER
  }

  toString(): string {
    return this.#chunks.join('')
  }

  #truncate(length: number): void {
    while (this.#length > length) {
      const chunk = this.#chunks.at(-1)
      if (chunk === undefined) break

      const excessLength = this.#length - length
      if (chunk.length <= excessLength) {
        this.#chunks.pop()
        this.#length -= chunk.length
      } else {
        this.#chunks[this.#chunks.length - 1] = chunk.slice(0, chunk.length - excessLength)
        this.#length = length
      }
    }
  }
}

function getMessageText(message: TurnStartRequest['userMessage']): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()
}

function normalizeGeneratedTitle(value: string): string | null {
  const title = value
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^(?:title|标题)\s*[:：]\s*/i, '')
    .trim()
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .replace(/[.!?。！？]+$/g, '')
    .trim()
  return title ? Array.from(title).slice(0, MAX_SESSION_TITLE_CHARS).join('') : null
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

export { TurnExecutor }
