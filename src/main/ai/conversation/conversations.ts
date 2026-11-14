import type { ModelReasoningCapabilities } from '@mico/ai-providers'
import type { PermissionResponse } from '@shared/ai/permissions'
import type {
  ExecutionProfileSnapshot,
  PersistedSession,
  SessionSummary
} from '@shared/data/schemas/session'
import type { TurnStartRequest, TurnStreamEvent } from '@shared/ipc/schemas/chat'
import type { SessionDatabase } from '@main/data/session-database'
import type { Models } from '../models'
import type { Workspaces } from '../workspace'
import type { ToolHooks } from '../tools'
import type { Memories } from '../memory'
import { SessionCompactor, type SessionCompactionOutcome } from './compaction'
import { SessionModelProfile } from './model-profile'
import { SessionRuntimeService } from './runtime'
import type { SessionTitleUpdate } from './title-generator'
import { TurnExecutor } from './turn'
import {
  DEFAULT_APPLICATION_INPUT_BUDGET_TOKENS,
  validateApplicationInputBudget
} from './auto-compaction'

interface ConversationsOptions {
  database: SessionDatabase
  models: Models
  workspace?: Workspaces
  memories?: Memories
  createId?: () => string
  now?: () => number
  toolHooks?: ToolHooks
  maxAssistantTextChars?: number
  maxAttempts?: number
  retryDelayMs?: number
  maxSummaryChars?: number
  /** Application policy based on approximate input measurement; false disables automatic compaction. */
  applicationInputBudgetTokens?: number | false
}

interface CreateSessionInput {
  title: string
  defaultProfile: ExecutionProfileSnapshot | null
  projectId?: string | null
  cwd?: string | null
}

/**
 * Owns persistent conversations and their in-flight work. Callers supply domain
 * owners once; turn acceptance, model profiles, replay, permissions and manual
 * compaction share the same runtime internally.
 */
class Conversations {
  private readonly runtime: SessionRuntimeService
  private readonly profiles: SessionModelProfile
  private readonly executor: TurnExecutor
  private readonly compactor: SessionCompactor

  constructor(options: ConversationsOptions) {
    const runtimeOptions: ConstructorParameters<typeof SessionRuntimeService>[0] = {
      database: options.database
    }
    if (options.createId) runtimeOptions.createId = options.createId
    if (options.now) runtimeOptions.now = options.now
    this.runtime = new SessionRuntimeService(runtimeOptions)
    this.profiles = new SessionModelProfile({ models: options.models, runtime: this.runtime })
    this.compactor = new SessionCompactor({
      runtime: this.runtime,
      modelProfile: this.profiles,
      maxSummaryChars: options.maxSummaryChars
    })
    const workspace = options.workspace
    const turnOptions: ConstructorParameters<typeof TurnExecutor>[0] = {
      profiles: this.profiles,
      runtime: this.runtime,
      compactor: this.compactor,
      memories: options.memories,
      applicationInputBudgetTokens: validateApplicationInputBudget(
        options.applicationInputBudgetTokens ?? DEFAULT_APPLICATION_INPUT_BUDGET_TOKENS
      ),
      toolHooks: options.toolHooks,
      maxAssistantTextChars: options.maxAssistantTextChars,
      maxAttempts: options.maxAttempts,
      retryDelayMs: options.retryDelayMs
    }
    if (workspace) turnOptions.enterTurn = (cwd) => workspace.prepareSources(cwd)
    this.executor = new TurnExecutor(turnOptions)
  }

  createSession(input: CreateSessionInput): SessionSummary {
    return this.runtime.createSession(input)
  }

  listSessions(): SessionSummary[] {
    return this.runtime.listSessions()
  }

  loadSession(sessionId: string): PersistedSession {
    return this.runtime.loadSession(sessionId)
  }

  renameSession(sessionId: string, title: string): SessionSummary {
    return this.runtime.renameSession(sessionId, title)
  }

  deleteSession(sessionId: string): void {
    this.assertNoAdmission(sessionId)
    this.runtime.deleteSession(sessionId)
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

  respondToPermission(ownerId: string, response: PermissionResponse): void {
    this.executor.respondToPermission(ownerId, response)
  }

  async compact(sessionId: string): Promise<SessionCompactionOutcome> {
    this.assertNoAdmission(sessionId)
    return this.compactor.compact(sessionId)
  }

  private assertNoAdmission(sessionId: string): void {
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

  recoverInterruptedRuns(): number {
    return this.runtime.recoverInterruptedRuns()
  }

  /** Stops summaries before the caller's renderer draft-save phase. */
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

export { Conversations }
export type { ConversationsOptions, CreateSessionInput }
