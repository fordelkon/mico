import { createHash } from 'node:crypto'

import {
  resolveThinkingSelection,
  type ChatProvider,
  type ChatProviderMessage,
  type ChatProviderConfiguration
} from '@mico/ai-providers'
import type { ChatDocumentPart, ChatMessage } from '@shared/data/schemas/chat'
import type { TurnStartRequest, TurnStreamEvent, TurnTerminalEvent } from '@shared/ipc/schemas/chat'

import { NoModelSelectedError, toTurnFailure } from './turn-failure'
import type { ChatProviderResolver } from './chat-provider-resolver'
import { ToolAgentRunner } from '../tools/tool-agent-runner'
import { createProjectAgentInstructions } from '../tools/project-agent-instructions'
import { ToolRegistry } from '../tools/tool-registry'
import {
  type ExecutionProfileSnapshot,
  type SessionRuntimeService
} from '../sessions/session-runtime-service'
import { toDisplayToolTrace } from '../sessions/tool-trace-presentation'

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
  getChatConfigurationForModelEntry?: (modelEntryId: string) => ChatProviderConfiguration | null
  getSelectedModelEntryId?: () => string | null
  getSelectedChatConfiguration?: () => ChatProviderConfiguration | null
  maxAssistantTextChars?: number
  maxAttempts?: number
  retryDelayMs?: number
  runtime?: Pick<
    SessionRuntimeService,
    | 'finishRun'
    | 'getDefaultProfile'
    | 'getReplayMessages'
    | 'loadSession'
    | 'markRequestStarted'
    | 'recordToolTrace'
    | 'recordAgentStep'
    | 'renameSessionIfCurrentTitle'
    | 'retryTurn'
    | 'startTurn'
    | 'updateDefaultProfile'
  >
}

const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_RETRY_DELAY_MS = 1_000
// The same ceiling must bound persisted text and renderer deltas so either process cannot grow alone.
const DEFAULT_MAX_ASSISTANT_TEXT_CHARS = 256 * 1024
const DEFAULT_SESSION_TITLE = 'New chat'
const MAX_SESSION_TITLE_CHARS = 50
// Exported so tests can tell title-generation streams from agent-turn streams.
export const SESSION_TITLE_INSTRUCTIONS = `You are a conversation title generator.

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
      getChatConfigurationForModelEntry,
      getSelectedModelEntryId,
      getSelectedChatConfiguration
    }: TurnExecutorOptions = {}
  ) {
    this.resolveProvider = resolveProvider
    this.maxAttempts = maxAttempts
    this.maxAssistantTextChars = maxAssistantTextChars
    this.retryDelayMs = retryDelayMs
    this.runtime = runtime
    this.getChatConfigurationForModelEntry = getChatConfigurationForModelEntry
    this.getSelectedModelEntryId = getSelectedModelEntryId
    this.getSelectedChatConfiguration = getSelectedChatConfiguration
  }

  private readonly runtime: TurnExecutorOptions['runtime']
  private readonly getChatConfigurationForModelEntry: TurnExecutorOptions['getChatConfigurationForModelEntry']
  private readonly getSelectedModelEntryId: TurnExecutorOptions['getSelectedModelEntryId']
  private readonly getSelectedChatConfiguration: TurnExecutorOptions['getSelectedChatConfiguration']

  getModelCapabilities(): ReturnType<ChatProvider['getModelCapabilities']> {
    const modelEntryId = this.getSelectedModelEntryId?.()
    return (
      this.resolveProvider(modelEntryId ?? undefined)?.getModelCapabilities() ??
      Promise.resolve(null)
    )
  }

  updateSessionThinkingEffort(
    sessionId: string,
    thinkingEffort: ExecutionProfileSnapshot['thinkingEffort']
  ): void {
    const profile = this.runtime?.getDefaultProfile(sessionId)
    const configuration = profile?.modelEntryId
      ? this.getChatConfigurationForModelEntry?.(profile.modelEntryId)
      : this.getSelectedChatConfiguration?.()
    if (!configuration || !this.runtime) throw new NoModelSelectedError()
    if (!profile?.modelEntryId)
      throw new NoModelSelectedError('Select an enabled model for this session before chatting.')
    this.runtime.updateDefaultProfile(
      sessionId,
      toExecutionProfile(configuration, profile.modelEntryId, thinkingEffort)
    )
  }

  updateSessionModelEntry(sessionId: string, modelEntryId: string): void {
    const configuration = this.getChatConfigurationForModelEntry?.(modelEntryId)
    if (!configuration || !this.runtime) throw new NoModelSelectedError()
    const thinkingEffort = this.runtime.getDefaultProfile(sessionId)?.thinkingEffort ?? 'default'
    this.runtime.updateDefaultProfile(
      sessionId,
      toExecutionProfile(configuration, modelEntryId, thinkingEffort)
    )
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
      let effectiveThinkingEffort = request.thinkingEffort ?? 'default'
      let provider: ReturnType<ChatProviderResolver>

      if (this.runtime) {
        const defaultProfile = this.runtime.getDefaultProfile(request.sessionId)
        const selectedModelEntryId = this.getSelectedModelEntryId?.()
        const configuration = defaultProfile
          ? this.getChatConfigurationForModelEntry?.(defaultProfile.modelEntryId)
          : this.getSelectedChatConfiguration?.()
        if (!configuration) throw new NoModelSelectedError()
        const modelEntryId =
          defaultProfile?.modelEntryId ?? selectedModelEntryId ?? configuration.modelId
        provider = this.resolveProvider(modelEntryId)
        if (!provider) throw new NoModelSelectedError()
        const requestedThinkingEffort = request.thinkingEffort ?? 'default'
        effectiveThinkingEffort = request.retry
          ? 'default'
          : await resolveEffectiveThinkingEffort(provider, requestedThinkingEffort)
        if (!request.retry)
          this.runtime.updateDefaultProfile(
            request.sessionId,
            toExecutionProfile(configuration, modelEntryId, requestedThinkingEffort)
          )
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
              profile: toExecutionProfile(configuration, modelEntryId, effectiveThinkingEffort)
            })
        turn.runId = started.runId
        effectiveThinkingEffort = started.profile.thinkingEffort
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
      } else provider = this.resolveProvider()
      if (!provider) throw new NoModelSelectedError()

      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        try {
          const cwd = this.runtime?.loadSession(request.sessionId).cwd
          const messages = turn.runId
            ? (this.runtime?.getReplayMessages(turn.runId) ?? [
                toProviderMessage(request.userMessage)
              ])
            : [toProviderMessage(request.userMessage)]
          if (cwd)
            messages.unshift({
              role: 'system',
              parts: [{ type: 'text', text: createProjectAgentInstructions(cwd) }]
            })
          const runnerInput = {
            provider,
            messages,
            thinkingEffort: effectiveThinkingEffort,
            signal: turn.controller.signal,
            emit: (chunk) => {
              if (turn.controller.signal.aborted) return
              receivedChunk = true
              if (chunk.type === 'text-delta') {
                // Chunks append in O(delta); the full string is only materialized when read.
                const visibleDelta = turn.assistantTextBuilder.append(chunk.delta, chunk.id)
                if (visibleDelta)
                  emit({
                    type: 'chunk',
                    requestId: request.requestId,
                    chunk: { ...chunk, delta: visibleDelta }
                  })
                return
              }
              emit({ type: 'chunk', requestId: request.requestId, chunk })
            }
          }
          if (cwd) Object.assign(runnerInput, { registry: ToolRegistry.forWorkspace(cwd) })
          const toolTraces = new Map<
            string,
            Parameters<SessionRuntimeService['recordToolTrace']>[1]
          >()
          if (turn.runId)
            Object.assign(runnerInput, {
              onStep: (step: Parameters<SessionRuntimeService['recordAgentStep']>[1]) =>
                this.runtime?.recordAgentStep(turn.runId!, step),
              onToolResult: (trace: Parameters<SessionRuntimeService['recordToolTrace']>[1]) => {
                toolTraces.set(trace.toolCallId, trace)
                this.runtime?.recordToolTrace(turn.runId!, trace)
              }
            })
          const result = await new ToolAgentRunner().run(runnerInput)

          if (!turn.controller.signal.aborted) {
            if (turn.runId) {
              // Persist the exact stream order (see session-transcript.ts for the invariant):
              // reasoning, tool traces and interim texts keep their positions relative to the
              // texts around them instead of collapsing into one trailing blob.
              const displayParts: ChatMessage['parts'] = []
              for (const part of result.displaySequence) {
                if (part.type === 'reasoning') {
                  if (part.text) displayParts.push({ type: 'reasoning', text: part.text })
                } else if (part.type === 'text') {
                  const text = turn.assistantTextBuilder.visibleSegment(part.textId)
                  if (text.trim()) displayParts.push({ type: 'text', text })
                } else {
                  const trace = toolTraces.get(part.toolCallId)
                  if (trace) displayParts.push(toDisplayToolTrace(trace))
                }
              }
              if (!displayParts.length)
                displayParts.push({ type: 'text', text: turn.assistantTextBuilder.toString() })
              this.runtime?.finishRun(turn.runId, {
                status: 'completed',
                assistant: {
                  role: 'assistant',
                  parts: displayParts,
                  metadata: { completionState: 'complete' }
                }
              })
            }
            // A completed turn is durable before its UI gains completion-only actions.
            emit({
              type: 'chunk',
              requestId: request.requestId,
              chunk: { type: 'message-metadata', messageMetadata: { completionState: 'complete' } }
            })
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
            toTurnFailure(providerError).retryable

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
        const { failure } = toTurnFailure(
          error instanceof Error ? error : new Error('Unknown chat provider error')
        )
        if (turn.runId) {
          this.runtime?.finishRun(turn.runId, {
            status: 'failed',
            failure
          })
        }
        this.emitTerminal(turn, {
          type: 'error',
          requestId: request.requestId,
          message: failure.message
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
  // Visible text attributed per stream segment (text part id) so persistence can
  // rebuild part positions without re-deriving them from the joined string.
  readonly #segments = new Map<string, string[]>()

  constructor(maxLength: number) {
    this.#maxLength = maxLength
  }

  append(delta: string, segmentId?: string): string {
    const visible = this.#appendCapped(delta)
    if (segmentId && visible) {
      const segments = this.#segments.get(segmentId) ?? []
      segments.push(visible)
      this.#segments.set(segmentId, segments)
    }
    return visible
  }

  #appendCapped(delta: string): string {
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

  /** The visible text streamed under one text part id, honoring the shared cap. */
  visibleSegment(segmentId: string): string {
    return this.#segments.get(segmentId)?.join('') ?? ''
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

function formatDocument(part: ChatDocumentPart): string {
  const name = part.name
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
  return `<document name="${name}">\n${part.text}\n</document>`
}

function toProviderMessage(message: ChatMessage): ChatProviderMessage {
  return {
    ...message,
    // Tool traces are renderer-only persistence projections, never provider conversation context.
    parts: message.parts
      .filter((part) => part.type !== 'tool-trace')
      .map((part) =>
        part.type === 'document' ? { type: 'text', text: formatDocument(part) } : part
      )
  }
}

function getMessageText(message: TurnStartRequest['userMessage']): string {
  return message.parts
    .filter((part) => part.type === 'text' || part.type === 'document')
    .map((part) => (part.type === 'document' ? formatDocument(part) : part.text))
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
  modelEntryId: string,
  thinkingEffort: ExecutionProfileSnapshot['thinkingEffort']
): ExecutionProfileSnapshot {
  const safeConfiguration = { ...configuration }
  if ('apiKey' in safeConfiguration) delete safeConfiguration.apiKey
  return {
    modelEntryId,
    providerId: configuration.provider,
    modelId: configuration.modelId,
    thinkingEffort,
    configurationDigest: createHash('sha256')
      .update(JSON.stringify(safeConfiguration))
      .digest('hex')
  }
}

async function resolveEffectiveThinkingEffort(
  provider: ChatProvider,
  requestedThinkingEffort: ExecutionProfileSnapshot['thinkingEffort']
): Promise<ExecutionProfileSnapshot['thinkingEffort']> {
  try {
    return resolveThinkingSelection(requestedThinkingEffort, await provider.getModelCapabilities())
  } catch {
    return 'default'
  }
}

export { TurnExecutor }
