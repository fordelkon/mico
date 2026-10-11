import type { PermissionResponse } from '@shared/ai/permissions'
import type { TurnStartRequest, TurnStreamEvent, TurnTerminalEvent } from '@shared/ipc/schemas/chat'
import type { SessionRuntimeService, TurnRunHandle } from '../sessions/session-runtime-service'
import { PermissionRequests } from '../tools/permission-requests'
import { ToolAgentRunner } from '../tools/tool-agent-runner'
import type { ToolHooks } from '../tools/tool-hooks'
import { ToolRegistry } from '../tools/tool-registry'
import { getMessageText } from './conversation-context'
import { resolveEffectiveThinkingEffort, SessionModelProfile } from './session-model-profile'
import { type SessionTitleUpdate, TitleGenerator } from './title-generator'
import { prepareTurnContext } from './turn-context'
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
  canPersist: boolean
}

type TurnExecutorOptions = {
  profiles: SessionModelProfile
  runtime?: Pick<
    SessionRuntimeService,
    'beginTurn' | 'renameSessionIfCurrentTitle' | 'getRetryProfile'
  >
  toolHooks?: ToolHooks
  maxAssistantTextChars?: number
  maxAttempts?: number
  retryDelayMs?: number
}

const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_RETRY_DELAY_MS = 1_000
// The same ceiling must bound persisted text and renderer deltas so either process cannot grow alone.
const DEFAULT_MAX_ASSISTANT_TEXT_CHARS = 256 * 1024

class TurnExecutor {
  private readonly permissions = new PermissionRequests()
  private readonly titleGenerator: TitleGenerator
  private readonly activeTurns = new Map<string, ActiveTurn>()
  private readonly executions = new Map<Promise<void>, ActiveTurn>()
  private isDisposed = false
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
        this.isDisposed
          ? null
          : (runtime?.renameSessionIfCurrentTitle(sessionId, currentTitle, title) ?? null)
    })
  }

  startTurn(
    { ownerId, request }: { ownerId: string; request: TurnStartRequest },
    emit: (event: TurnStreamEvent) => void,
    onTitleUpdated?: (update: SessionTitleUpdate) => void
  ): void {
    if (this.isDisposed)
      throw new Error('The application is shutting down. New turns cannot start.')
    for (const turn of this.executions.values()) {
      if (turn.ownerId === ownerId && turn.requestId === request.requestId) this.cancelTurn(turn)
    }

    const key = this.getTurnKey(ownerId, request.requestId)
    const turn = {
      assembler: new TurnDisplayAssembler(this.maxAssistantTextChars),
      controller: new AbortController(),
      emit,
      handle: null,
      ownerId,
      requestId: request.requestId,
      terminal: false,
      canPersist: true
    }
    this.activeTurns.set(key, turn)
    const execution = this.execute({ key, request, turn, emit, onTitleUpdated })
    this.executions.set(execution, turn)
    void execution.then(
      () => this.executions.delete(execution),
      (error) => {
        this.executions.delete(execution)
        console.error('Failed to settle chat turn', error)
      }
    )
  }

  async abortTurn({ ownerId, requestId }: { ownerId: string; requestId: string }): Promise<void> {
    const matching = [...this.executions].filter(
      ([, turn]) => turn.ownerId === ownerId && turn.requestId === requestId
    )
    for (const [, turn] of matching) this.cancelTurn(turn)
    await Promise.all(matching.map(([execution]) => execution))
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

  async drain(timeoutMs = 5_000): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.allSettled(this.executions.keys()),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            console.warn('Chat shutdown drain timed out; unresolved tool outcomes remain unknown.')
            resolve()
          }, timeoutMs)
        })
      ])
    } finally {
      if (timer) clearTimeout(timer)
      for (const turn of this.executions.values()) turn.canPersist = false
    }
  }

  dispose(): void {
    this.isDisposed = true
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
    try {
      const isRetry = request.retry === true || request.retryRunId !== undefined
      const retryProfile = isRetry
        ? this.runtime?.getRetryProfile(request.sessionId, request.retryRunId)
        : undefined
      const selection = retryProfile
        ? this.profiles.resolveForProfile(retryProfile)
        : this.profiles.resolveForSession(request.sessionId)
      const provider = selection.provider
      if (!provider) throw new NoModelSelectedError()

      const requestedThinkingEffort = request.thinkingEffort ?? 'default'
      let effectiveThinkingEffort = requestedThinkingEffort
      let handle: TurnRunHandle | null = null
      if (this.runtime) {
        const { configuration, modelEntryId } = selection
        if (!configuration || !modelEntryId) throw new NoModelSelectedError()
        if (!isRetry) {
          effectiveThinkingEffort = await resolveEffectiveThinkingEffort(
            provider,
            requestedThinkingEffort
          )
          turn.controller.signal.throwIfAborted()
          if (!turn.canPersist) throw new Error('Turn setup cannot continue after shutdown.')
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
          retry: isRetry,
          retryRunId: request.retryRunId
        })
        turn.handle = handle
        effectiveThinkingEffort = handle.profile.thinkingEffort
      }

      turn.controller.signal.throwIfAborted()
      const context = await prepareTurnContext(request.userMessage, handle, turn.controller.signal)
      turn.controller.signal.throwIfAborted()
      const { cwd, skills, authorizedSkillIds } = context
      if (handle?.shouldGenerateTitle)
        this.titleGenerator.maybeGenerate({
          sessionId: request.sessionId,
          provider,
          sourceText: getMessageText(request.userMessage),
          signal: turn.controller.signal,
          onTitleUpdated
        })
      const registry = cwd
        ? ToolRegistry.forWorkspace(cwd, {
            skills,
            authorizedSkillIds,
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
      const messages = context.history

      {
        const runnerInput: Parameters<ToolAgentRunner['run']>[0] = {
          provider,
          messages,
          prepareMessages: (history) => context.messages(history, registry?.definitions),
          maxAttempts: this.maxAttempts,
          retryDelayMs: this.retryDelayMs,
          onRetry: (event) => emit({ type: 'retry', requestId: request.requestId, ...event }),
          thinkingEffort: effectiveThinkingEffort,
          signal: turn.controller.signal,
          emit: (chunk) => {
            if (turn.controller.signal.aborted) return
            const visibleChunk = turn.assembler.observeChunk(chunk)
            if (visibleChunk)
              emit({ type: 'chunk', requestId: request.requestId, chunk: visibleChunk })
          }
        }
        if (registry) runnerInput.registry = registry
        if (handle) {
          const persist = (action: () => void): void => {
            if (turn.canPersist) action()
          }
          runnerInput.journal = {
            recordModelStep: (step) => persist(() => handle.recordModelStep(step)),
            recordToolExecutionStarted: (execution) => {
              turn.controller.signal.throwIfAborted()
              if (!turn.canPersist) throw new Error('Tool execution cannot start after shutdown.')
              handle.recordToolExecutionStarted(execution)
            },
            recordToolExecutionSettled: (execution) =>
              persist(() => handle.recordToolExecutionSettled(execution))
          }
          runnerInput.onStep = (step) => persist(() => handle.recordStep(step))
          runnerInput.onToolResult = (trace) => turn.assembler.recordTrace(trace)
        }
        await new ToolAgentRunner().run(runnerInput)

        if (!turn.controller.signal.aborted) {
          if (handle) {
            const assistant = turn.assembler.buildMessage('complete')
            if (assistant) handle.complete(assistant)
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
      }
    } catch (error) {
      if (!turn.controller.signal.aborted) {
        const { failure } = toTurnFailure(
          error instanceof Error ? error : new Error('Unknown chat provider error')
        )
        if (turn.canPersist) turn.handle?.fail(failure, turn.assembler.buildMessage('stopped'))
        this.emitTerminal(turn, {
          type: 'error',
          requestId: request.requestId,
          message: failure.message
        })
      }
    } finally {
      if (turn.controller.signal.aborted && turn.canPersist) this.cancelPersistedRun(turn)
      if (this.activeTurns.get(key) === turn) this.activeTurns.delete(key)
    }
  }

  private getTurnKey(ownerId: string, requestId: string): string {
    return `${ownerId.length}:${ownerId}${requestId}`
  }

  private cancelPersistedRun(turn: ActiveTurn): void {
    const handle = turn.handle
    if (!handle) return
    handle.cancel(turn.assembler.buildMessage('stopped'))
  }

  private cancelTurn(turn: ActiveTurn): void {
    if (turn.terminal) return
    turn.controller.abort()
    this.emitTerminal(turn, { type: 'cancelled', requestId: turn.requestId })
  }

  private emitTerminal(turn: ActiveTurn, event: TurnTerminalEvent): void {
    if (turn.terminal) return
    turn.terminal = true
    turn.emit(event)
  }
}

export { TurnExecutor }
