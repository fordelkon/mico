import type { ModelReasoningCapabilities } from '@mico/ai-providers'
import type { ExecutionProfileSnapshot, TurnStartRequest, TurnStreamEvent } from '../contracts'
import type { SessionStore } from './session-store'
import { SessionModelProfile, type SessionModels } from './model-profile'
import { TurnExecutor, type TurnExecutorOptions } from './turn'
import { SessionCompactor, type SessionCompactionOutcome } from './compaction'
import type { SessionTitleUpdate } from './title-generator'
import { DEFAULT_APPLICATION_INPUT_BUDGET_TOKENS } from './auto-compaction'

interface CodingAgentOptions
  extends Omit<TurnExecutorOptions, 'runtime' | 'profiles' | 'compactor'> {
  runtime: SessionStore
  models: SessionModels
  maxSummaryChars?: number
}

/** Coordinates session admission, active turns, summaries, and graceful shutdown. */
class CodingAgent {
  private readonly profiles: SessionModelProfile
  private readonly executor: TurnExecutor
  private readonly compactor: SessionCompactor

  constructor({
    runtime,
    models,
    maxSummaryChars,
    applicationInputBudgetTokens = DEFAULT_APPLICATION_INPUT_BUDGET_TOKENS,
    ...options
  }: CodingAgentOptions) {
    this.profiles = new SessionModelProfile({ models, runtime })
    this.compactor = new SessionCompactor({ runtime, modelProfile: this.profiles, maxSummaryChars })
    this.executor = new TurnExecutor({
      ...options,
      runtime,
      profiles: this.profiles,
      compactor: this.compactor,
      applicationInputBudgetTokens
    })
  }

  startTurn(
    input: { ownerId: string; request: TurnStartRequest },
    emit: (event: TurnStreamEvent) => void,
    onTitleUpdated?: (update: SessionTitleUpdate) => void
  ): void {
    if (
      this.compactor.isCompacting(input.request.sessionId) &&
      !this.executor.isSessionExecuting(input.request.sessionId)
    )
      throw new Error(
        'A summary is running for this session. Wait for it to settle before sending.'
      )
    this.executor.startTurn(input, emit, onTitleUpdated)
  }

  abortTurn(input: { ownerId: string; requestId: string }): Promise<void> {
    return this.executor.abortTurn(input)
  }

  abortAllTurns(ownerId: string): void {
    this.executor.abortAllTurns(ownerId)
  }

  async compact(sessionId: string): Promise<SessionCompactionOutcome> {
    this.assertNoAdmission(sessionId)
    return this.compactor.compact(sessionId)
  }

  protected assertNoAdmission(sessionId: string): void {
    if (this.executor.isSessionExecuting(sessionId))
      throw new Error('Session has an active request. Wait for it to settle before continuing.')
  }

  cancelCompaction(sessionId: string): Promise<void> {
    return this.compactor.cancel(sessionId)
  }

  setSessionModelEntry(sessionId: string, modelEntryId: string): void {
    this.profiles.updateSessionModelEntry(sessionId, modelEntryId)
  }

  setSessionThinkingEffort(
    sessionId: string,
    thinkingEffort: ExecutionProfileSnapshot['thinkingEffort']
  ): void {
    this.profiles.updateSessionThinkingEffort(sessionId, thinkingEffort)
  }

  getCapabilities(sessionId?: string): Promise<ModelReasoningCapabilities | null> {
    return this.profiles.getCapabilities(sessionId)
  }

  /** Stops summaries before shutting down foreground turns. */
  stopCompactions(): void {
    this.compactor.dispose()
  }

  /** Stops turns and settles all persistence before storage can close. */
  async drain(timeoutMs?: number): Promise<void> {
    try {
      this.executor.dispose()
    } finally {
      try {
        await this.executor.drain(timeoutMs)
      } finally {
        await this.compactor.drain()
      }
    }
  }

  /** Idempotent cancellation of both work owners; drain settles their writes. */
  dispose(): void {
    try {
      this.executor.dispose()
    } finally {
      this.compactor.dispose()
    }
  }
}

export { CodingAgent }
export type { CodingAgentOptions }
