import type { ToolPermissionData } from '../contracts'
import type { TurnStartRequest, TurnStreamEvent, TurnTerminalEvent } from '../contracts/turn'
import type { SessionStore, TurnRunHandle } from './session-store'
import { runModelLoop, TextGeneration } from '@mico/agent-core'
import type { ToolApprovalRequest } from '../tools/permissions'
import type { ToolHooks } from '../tools/hooks'
import type { TurnMemory } from './turn-context'
import { getMessageText } from './provider-messages'
import { resolveEffectiveThinkingEffort, SessionModelProfile } from './model-profile'
import { type SessionTitleUpdate, TitleGenerator } from './title-generator'
import {
  captureTurnContext,
  type CapturedTurnContext,
  type TurnContextOptions
} from './turn-context'
import { CompactionPersistenceFailed, type SessionCompactor } from './compaction'
import { compactPendingContext, validateApplicationInputBudget } from './auto-compaction'
import { TurnDisplayAssembler } from './display'
import { toTurnFailure } from './turn-failure'

type ActiveTurn = {
  assembler: TurnDisplayAssembler
  controller: AbortController
  emit: (event: TurnStreamEvent) => void
  handle: TurnRunHandle | null
  ownerId: string
  requestId: string
  sessionId: string
  terminal: boolean
  canPersist: boolean
}

type RequestApproval = (
  request: ToolApprovalRequest & { ownerId: string; sessionId: string; requestId: string },
  signal: AbortSignal,
  emit: (data: ToolPermissionData) => void
) => Promise<boolean>

type TurnExecutorOptions = {
  requestApproval: RequestApproval
  profiles: SessionModelProfile
  runtime: Pick<
    SessionStore,
    | 'beginTurn'
    | 'renameSessionIfCurrentTitle'
    | 'getRetryProfile'
    | 'previewTurn'
    | 'getCompactionSource'
    | 'getLatestCheckpointCoverage'
  >
  compactor?: Pick<SessionCompactor, 'compact'>
  applicationInputBudgetTokens?: number | false
  memories?: TurnMemory
  toolHooks?: ToolHooks
  maxAssistantTextChars?: number
  maxAttempts?: number
  retryDelayMs?: number
}

// The same ceiling must bound persisted text and renderer deltas so either process cannot grow alone.
const DEFAULT_MAX_ASSISTANT_TEXT_CHARS = 256 * 1024

class TurnExecutor {
  private readonly requestApproval: RequestApproval
  private readonly titleGenerator: TitleGenerator
  private readonly textGeneration = new TextGeneration()
  private readonly activeTurns = new Map<string, ActiveTurn>()
  private readonly executions = new Map<Promise<void>, ActiveTurn>()
  private isDisposed = false
  private readonly maxAttempts?: number
  private readonly maxAssistantTextChars: number
  private readonly retryDelayMs?: number

  private readonly profiles: SessionModelProfile
  private readonly runtime: TurnExecutorOptions['runtime']
  private readonly toolHooks: ToolHooks
  private readonly memories: TurnMemory | undefined
  private readonly compactor: TurnExecutorOptions['compactor']
  private readonly applicationInputBudgetTokens: number | false

  constructor({
    requestApproval,
    profiles,
    runtime,
    compactor,
    applicationInputBudgetTokens = false,
    memories,
    toolHooks = {},
    maxAttempts,
    maxAssistantTextChars = DEFAULT_MAX_ASSISTANT_TEXT_CHARS,
    retryDelayMs
  }: TurnExecutorOptions) {
    this.requestApproval = requestApproval
    this.profiles = profiles
    this.runtime = runtime
    this.compactor = compactor
    this.applicationInputBudgetTokens = validateApplicationInputBudget(applicationInputBudgetTokens)
    this.memories = memories
    this.toolHooks = toolHooks
    this.maxAttempts = maxAttempts
    this.maxAssistantTextChars = maxAssistantTextChars
    this.retryDelayMs = retryDelayMs
    this.titleGenerator = new TitleGenerator({
      textGeneration: this.textGeneration,
      renameIfCurrentTitle: (sessionId, currentTitle, title) =>
        this.isDisposed ? null : runtime.renameSessionIfCurrentTitle(sessionId, currentTitle, title)
    })
  }

  startTurn(
    { ownerId, request }: { ownerId: string; request: TurnStartRequest },
    emit: (event: TurnStreamEvent) => void,
    onTitleUpdated?: (update: SessionTitleUpdate) => void
  ): void {
    if (this.isDisposed)
      throw new Error('The application is shutting down. New turns cannot start.')
    const previous: Promise<void>[] = []
    for (const [execution, turn] of this.executions) {
      const sameRequest = turn.ownerId === ownerId && turn.requestId === request.requestId
      if (
        turn.sessionId === request.sessionId &&
        !sameRequest &&
        this.activeTurns.get(this.getTurnKey(turn.ownerId, turn.requestId)) === turn
      )
        throw new Error(
          'Session already has an active request. Wait for it to settle before sending.'
        )
      if (sameRequest) previous.push(execution)
    }
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
      sessionId: request.sessionId,
      terminal: false,
      canPersist: true
    }
    this.activeTurns.set(key, turn)
    const execution = this.execute({ key, request, turn, emit, onTitleUpdated, previous })
    this.executions.set(execution, turn)
    void execution.then(
      () => this.executions.delete(execution),
      (error) => {
        this.executions.delete(execution)
        console.error('Failed to settle chat turn', error)
      }
    )
  }

  isSessionExecuting(sessionId: string): boolean {
    return [...this.activeTurns.values()].some((turn) => turn.sessionId === sessionId)
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

  async drain(timeoutMs = 5_000): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.allSettled([...this.executions.keys(), this.textGeneration.drain()]),
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
    this.textGeneration.dispose()
    for (const turn of this.activeTurns.values()) {
      this.cancelTurn(turn)
    }
  }

  private async execute({
    key,
    request,
    turn,
    emit,
    onTitleUpdated,
    previous
  }: {
    key: string
    request: TurnStartRequest
    turn: ActiveTurn
    emit: (event: TurnStreamEvent) => void
    onTitleUpdated?: (update: SessionTitleUpdate) => void
    previous: Promise<void>[]
  }): Promise<void> {
    try {
      await Promise.all(previous)
      this.assertCanAccept(turn)
      const isRetry = request.retry === true || request.retryRunId !== undefined
      const preview = isRetry
        ? undefined
        : this.runtime.previewTurn(request.sessionId, request.requestId, request.userMessage)
      const retryProfile = isRetry
        ? this.runtime.getRetryProfile(request.sessionId, request.retryRunId)
        : preview?.profile
      const selection = retryProfile
        ? this.profiles.resolveForProfile(retryProfile)
        : this.profiles.resolveForSession(request.sessionId)
      const provider = selection.provider
      const originalDefaultProfile = this.profiles.getStoredProfile(request.sessionId)

      const requestedThinkingEffort =
        retryProfile?.thinkingEffort ?? request.thinkingEffort ?? 'default'
      let effectiveThinkingEffort = requestedThinkingEffort
      const { configuration, modelEntryId } = selection
      if (!isRetry && !preview?.existing) {
        effectiveThinkingEffort = await resolveEffectiveThinkingEffort(
          provider,
          requestedThinkingEffort
        )
        turn.controller.signal.throwIfAborted()
        if (!turn.canPersist) throw new Error('Turn setup cannot continue after shutdown.')
      }
      const preparationOptions: TurnContextOptions = {
        memories: this.memories,
        permissionMode: request.permissionMode ?? 'default',
        hooks: this.toolHooks,
        requestApproval: (call, signal) =>
          this.requestApproval(
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
      }
      let captured: CapturedTurnContext | undefined
      if (preview && !preview.existing) {
        captured = await captureTurnContext(
          request.userMessage,
          preview,
          preparationOptions,
          turn.controller.signal
        )
        this.assertCanAccept(turn)
        await compactPendingContext({
          sessionId: request.sessionId,
          budget: this.applicationInputBudgetTokens,
          captured,
          replay: () =>
            this.runtime.previewTurn(request.sessionId, request.requestId, request.userMessage)
              .replayMessages,
          runtime: this.runtime,
          compactor: this.compactor,
          thinkingEffort: effectiveThinkingEffort,
          signal: turn.controller.signal
        })
        this.assertCanAccept(turn)
        this.profiles.resolveForProfile(
          this.profiles.toProfile(configuration, modelEntryId, effectiveThinkingEffort)
        )
      }
      this.assertCanAccept(turn)
      const handle = this.runtime.beginTurn({
        sessionId: request.sessionId,
        requestId: request.requestId,
        userMessage: request.userMessage,
        profile: this.profiles.toProfile(configuration, modelEntryId, effectiveThinkingEffort),
        retry: isRetry,
        retryRunId: request.retryRunId
      })
      turn.handle = handle
      if (!isRetry && !preview?.existing)
        this.profiles.acceptSessionProfile(
          request.sessionId,
          originalDefaultProfile,
          this.profiles.toProfile(configuration, modelEntryId, requestedThinkingEffort)
        )
      effectiveThinkingEffort = handle.profile.thinkingEffort

      captured ??= await captureTurnContext(
        request.userMessage,
        handle,
        preparationOptions,
        turn.controller.signal
      )
      const context = captured.accept(handle)
      turn.controller.signal.throwIfAborted()
      if (handle.shouldGenerateTitle)
        this.titleGenerator.maybeGenerate({
          sessionId: request.sessionId,
          provider,
          sourceText: getMessageText(request.userMessage),
          signal: turn.controller.signal,
          onTitleUpdated
        })
      const persist = (action: () => void): void => {
        if (turn.canPersist) action()
      }
      await runModelLoop({
        provider,
        messages: context.history,
        registry: context.registry,
        prepareStep: (history) => {
          const prepared = context.prepareStep(history, effectiveThinkingEffort)
          if (!turn.controller.signal.aborted && !turn.terminal)
            emit({
              type: 'context-measurement',
              requestId: request.requestId,
              measurement: prepared.measurement
            })
          return prepared.request
        },
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
        },
        journal: {
          recordModelStep: (step) => persist(() => handle.recordModelStep(step)),
          recordToolExecutionStarted: (execution) => {
            turn.controller.signal.throwIfAborted()
            if (!turn.canPersist) throw new Error('Tool execution cannot start after shutdown.')
            handle.recordToolExecutionStarted(execution)
          },
          recordToolExecutionSettled: (execution) =>
            persist(() => handle.recordToolExecutionSettled(execution))
        },
        onStep: (step) => persist(() => handle.recordStep(step)),
        onToolResult: (trace) => turn.assembler.recordTrace(trace)
      })

      if (!turn.controller.signal.aborted) {
        const assistant = turn.assembler.buildMessage('complete')
        if (assistant) handle.complete(assistant)
        // A completed turn is durable before its UI gains completion-only actions.
        emit({
          type: 'chunk',
          requestId: request.requestId,
          chunk: { type: 'message-metadata', messageMetadata: { completionState: 'complete' } }
        })
        this.emitTerminal(turn, { type: 'finish', requestId: request.requestId })
      }
    } catch (error) {
      if (!turn.controller.signal.aborted) {
        const failure = toTurnFailure(
          error instanceof Error ? error : new Error('Unknown chat provider error')
        )
        if (turn.canPersist) turn.handle?.fail(failure, turn.assembler.buildMessage('stopped'))
        this.emitTerminal(turn, {
          type: 'error',
          requestId: request.requestId,
          message: failure.message
        })
      }
      if (error instanceof CompactionPersistenceFailed) throw error
    } finally {
      if (turn.controller.signal.aborted && turn.canPersist) this.cancelPersistedRun(turn)
      if (this.activeTurns.get(key) === turn) this.activeTurns.delete(key)
    }
  }

  private assertCanAccept(turn: ActiveTurn): void {
    turn.controller.signal.throwIfAborted()
    if (this.isDisposed || !turn.canPersist)
      throw new Error('Turn setup cannot continue after shutdown.')
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
export type { TurnExecutorOptions }
