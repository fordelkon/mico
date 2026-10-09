import type { PermissionResponse } from '@shared/ai/permissions'
import type { TurnStartRequest, TurnStreamEvent, TurnTerminalEvent } from '@shared/ipc/schemas/chat'
import { loadProjectInstructions } from '../context/project-instructions'
import type { SessionRuntimeService, TurnRunHandle } from '../sessions/session-runtime-service'
import { createSkillSnapshot } from '../skills'
import { PermissionRequests } from '../tools/permission-requests'
import { createProjectAgentInstructions } from '../tools/project-agent-instructions'
import { ToolAgentRunner } from '../tools/tool-agent-runner'
import type { ToolExecutionTrace } from '../tools/tool-contract'
import type { ToolHooks } from '../tools/tool-hooks'
import { ToolRegistry } from '../tools/tool-registry'
import { getMessageText, toProviderContext } from './conversation-context'
import { resolveEffectiveThinkingEffort, SessionModelProfile } from './session-model-profile'
import { type SessionTitleUpdate, TitleGenerator } from './title-generator'
import { TurnDisplayAssembler } from './turn-display-assembler'
import { NoModelSelectedError, toTurnFailure } from './turn-failure'

type ActiveTurn = {
  assembler: TurnDisplayAssembler
  controller: AbortController
  emit: (event: TurnStreamEvent) => void
  handle: TurnRunHandle | null
  ownerId: string
  requestId: string
  terminal: boolean
}

type TurnExecutorOptions = {
  profiles: SessionModelProfile
  runtime?: Pick<SessionRuntimeService, 'beginTurn' | 'renameSessionIfCurrentTitle'>
  toolHooks?: ToolHooks
  maxAssistantTextChars?: number
  maxAttempts?: number
  retryDelayMs?: number
}

const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_RETRY_DELAY_MS = 1_000
// The same ceiling must bound persisted text and renderer deltas so either process cannot grow alone.
const DEFAULT_MAX_ASSISTANT_TEXT_CHARS = 256 * 1024

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
  private readonly permissions = new PermissionRequests()
  private readonly titleGenerator: TitleGenerator
  private readonly activeTurns = new Map<string, ActiveTurn>()
  private readonly maxAttempts: number
  private readonly maxAssistantTextChars: number
  private readonly retryDelayMs: number

  private readonly profiles: SessionModelProfile
  private readonly runtime: TurnExecutorOptions['runtime']
  private readonly toolHooks: ToolHooks

  constructor({
    profiles,
    runtime,
    toolHooks = {},
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    maxAssistantTextChars = DEFAULT_MAX_ASSISTANT_TEXT_CHARS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS
  }: TurnExecutorOptions) {
    this.profiles = profiles
    this.runtime = runtime
    this.toolHooks = toolHooks
    this.maxAttempts = maxAttempts
    this.maxAssistantTextChars = maxAssistantTextChars
    this.retryDelayMs = retryDelayMs
    this.titleGenerator = new TitleGenerator({
      renameIfCurrentTitle: (sessionId, currentTitle, title) =>
        runtime?.renameSessionIfCurrentTitle(sessionId, currentTitle, title) ?? null
    })
  }

  startTurn(
    { ownerId, request }: { ownerId: string; request: TurnStartRequest },
    emit: (event: TurnStreamEvent) => void,
    onTitleUpdated?: (update: SessionTitleUpdate) => void
  ): void {
    this.abortTurn({ ownerId, requestId: request.requestId })

    const key = this.getTurnKey(ownerId, request.requestId)
    const turn = {
      assembler: new TurnDisplayAssembler(this.maxAssistantTextChars),
      controller: new AbortController(),
      emit,
      handle: null,
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

  respondToPermission(ownerId: string, response: PermissionResponse): void {
    this.permissions.respond(ownerId, response)
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
      const selection = this.profiles.resolveForSession(request.sessionId)
      const provider = selection.provider
      if (!provider) throw new NoModelSelectedError()

      const requestedThinkingEffort = request.thinkingEffort ?? 'default'
      let effectiveThinkingEffort = requestedThinkingEffort
      let handle: TurnRunHandle | null = null
      if (this.runtime) {
        const { configuration, modelEntryId } = selection
        if (!configuration || !modelEntryId) throw new NoModelSelectedError()
        if (!request.retry) {
          effectiveThinkingEffort = await resolveEffectiveThinkingEffort(
            provider,
            requestedThinkingEffort
          )
          this.profiles.persistSessionProfile(
            request.sessionId,
            this.profiles.toProfile(configuration, modelEntryId, requestedThinkingEffort)
          )
        }
        handle = this.runtime.beginTurn({
          sessionId: request.sessionId,
          requestId: request.requestId,
          userMessage: request.userMessage,
          profile: this.profiles.toProfile(configuration, modelEntryId, effectiveThinkingEffort),
          retry: request.retry === true
        })
        turn.handle = handle
        effectiveThinkingEffort = handle.profile.thinkingEffort
        if (handle.shouldGenerateTitle)
          this.titleGenerator.maybeGenerate({
            sessionId: request.sessionId,
            provider,
            sourceText: getMessageText(request.userMessage),
            signal: turn.controller.signal,
            onTitleUpdated
          })
      }

      const cwd = handle?.cwd
      const skills = cwd ? await createSkillSnapshot(cwd) : undefined
      const projectInstructions = cwd ? await loadProjectInstructions(cwd) : null
      const registry = cwd
        ? ToolRegistry.forWorkspace(cwd, {
            skills,
            permissionMode: request.permissionMode ?? 'default',
            hooks: this.toolHooks,
            requestApproval: (call, signal) =>
              this.permissions.request(
                {
                  ...call,
                  ownerId: turn.ownerId,
                  sessionId: request.sessionId,
                  requestId: request.requestId
                },
                signal,
                (data) =>
                  emit({
                    type: 'chunk',
                    requestId: request.requestId,
                    chunk: { type: 'data-tool-permission', id: data.approvalId, data }
                  })
              )
          })
        : undefined
      const systemInstructions = cwd
        ? createProjectAgentInstructions(cwd, registry?.definitions, skills)
        : null
      const replayMessages = handle
        ? handle.replayMessages
        : [toProviderContext(request.userMessage)]

      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        try {
          const messages = [
            ...(systemInstructions
              ? [
                  {
                    role: 'system' as const,
                    parts: [{ type: 'text' as const, text: systemInstructions }]
                  }
                ]
              : []),
            ...replayMessages,
            // Fresh context follows replay so continuation adapters retain it.
            ...(projectInstructions
              ? [
                  {
                    role: 'user' as const,
                    parts: [
                      {
                        type: 'text' as const,
                        text: `Context for the current user request; does not replace that request.\n\n${projectInstructions}`
                      }
                    ]
                  }
                ]
              : [])
          ]
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
                const visibleDelta = turn.assembler.appendText(chunk.delta, chunk.id)
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
          if (registry) Object.assign(runnerInput, { registry })
          const toolTraces = new Map<string, ToolExecutionTrace>()
          if (handle)
            Object.assign(runnerInput, {
              onStep: (step) => handle.recordStep(step),
              onToolResult: (trace: ToolExecutionTrace) => {
                toolTraces.set(trace.toolCallId, trace)
                handle.recordTrace(trace)
              }
            })
          const result = await new ToolAgentRunner().run(runnerInput)

          if (!turn.controller.signal.aborted) {
            if (handle) {
              // Persist the exact stream order (see session-transcript.ts for the invariant):
              // reasoning, tool traces and interim texts keep their positions relative to the
              // texts around them instead of collapsing into one trailing blob.
              handle.complete({
                role: 'assistant',
                parts: turn.assembler.buildParts(result.displaySequence, toolTraces),
                metadata: { completionState: 'complete' }
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
        turn.handle?.fail(failure)
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
    const handle = turn.handle
    if (!handle) return
    const text = turn.assembler.text()
    if (!text) {
      handle.cancel()
      return
    }

    handle.cancel({
      role: 'assistant',
      parts: [{ type: 'text', text }],
      metadata: { completionState: 'stopped' }
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
}

export { TurnExecutor }
