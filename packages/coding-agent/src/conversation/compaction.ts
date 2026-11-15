import { createSessionSummaryInstructions } from '../prompt/summary-instructions'
import type { ChatProvider } from '@mico/ai-providers'
import type { ExecutionProfileSnapshot } from '../contracts'
import type { CompactionNoticeReason, SessionStore } from './session-store'
import type { SessionModelProfile } from './model-profile'
import { prepareTextInput, ProviderInputLimitExceeded } from '../context/provider-input'
import { TextGeneration, TextGenerationRejected } from '@mico/agent-core'

/** Hard ceiling for one accepted summary; accumulation stops here before memory can grow unbounded. */
const DEFAULT_MAX_SUMMARY_CHARS = 20_000
const MAX_NOTICE_MESSAGE_CHARS = 2_000
const MAX_PERSISTENCE_FAILURE_SAMPLES = 10

/**
 * What one manual summary operation ended as. `accepted` carries the durable
 * checkpoint id; `cancelled` and `failed` outcomes are recorded as durable
 * compaction notices before the outcome reaches the caller.
 */
export type SessionCompactionOutcome =
  | { status: 'accepted'; checkpointEventId: string }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string }

/** Direct refusal of a summary request; nothing durable was captured, so no notice applies. */
class CompactionRefused extends Error {}
class CompactionPersistenceFailed extends Error {}
/** The compaction source moved while the summary was being generated. */
class CompactionSourceChanged extends Error {}
/** The session's model profile changed while the summary was being generated. */
class CompactionProfileChanged extends Error {}

type CompactionSource = NonNullable<ReturnType<SessionStore['getCompactionSource']>>

type SessionCompactorDependencies = {
  runtime: Pick<
    SessionStore,
    | 'getCompactionSource'
    | 'acceptContextCheckpoint'
    | 'getDefaultProfile'
    | 'beginCompaction'
    | 'endCompaction'
    | 'recordCompactionNotice'
  >
  modelProfile: Pick<SessionModelProfile, 'resolveForSession' | 'toProfile'>
  maxSummaryChars?: number
}

interface CompactionOptions {
  trigger?: 'manual' | 'auto'
  signal?: AbortSignal
}

type CompactionOperation = {
  controller: AbortController
  promise: Promise<SessionCompactionOutcome>
}

/**
 * Bounded manual conversation summary orchestration. One operation per
 * session. It freezes the compaction source and the
 * session profile, runs exactly one dedicated provider request, validates the
 * bounded plain-text output, and durably records the outcome before answering.
 */
class SessionCompactor {
  private readonly dependencies: SessionCompactorDependencies
  private readonly operations = new Map<string, CompactionOperation>()
  private readonly textGeneration = new TextGeneration()
  private pendingPersistenceFailures: Error[] = []
  private pendingPersistenceFailureCount = 0
  private isDisposed = false
  private readonly maxSummaryChars: number

  constructor(dependencies: SessionCompactorDependencies) {
    this.dependencies = dependencies
    this.maxSummaryChars = dependencies.maxSummaryChars ?? DEFAULT_MAX_SUMMARY_CHARS
  }

  compact(sessionId: string, options: CompactionOptions = {}): Promise<SessionCompactionOutcome> {
    if (this.isDisposed)
      return Promise.reject(new Error('The application is shutting down. Summaries cannot start.'))
    if (this.operations.has(sessionId))
      return Promise.reject(new Error('A summary is already running for this session.'))
    if (options.signal?.aborted) return Promise.reject(options.signal.reason)
    const controller = new AbortController()
    const abort = (): void => controller.abort(options.signal?.reason)
    options.signal?.addEventListener('abort', abort, { once: true })
    const execution = this.runOperation(sessionId, controller, options.trigger ?? 'manual')
    const promise = execution
      .catch((error: Error) => {
        if (error instanceof CompactionPersistenceFailed) {
          this.pendingPersistenceFailureCount += 1
          if (this.pendingPersistenceFailures.length < MAX_PERSISTENCE_FAILURE_SAMPLES)
            this.pendingPersistenceFailures = [
              ...this.pendingPersistenceFailures,
              new Error(error.message.slice(0, MAX_NOTICE_MESSAGE_CHARS))
            ]
        }
        throw error
      })
      .finally(() => {
        options.signal?.removeEventListener('abort', abort)
        if (this.operations.get(sessionId)?.promise === promise) this.operations.delete(sessionId)
      })
    this.operations.set(sessionId, { controller, promise })
    // The caller receives the rejecting promise; this observer only prevents an
    // unhandled rejection when shutdown owns the outstanding operation instead.
    void promise.catch(() => {})
    return promise
  }

  /**
   * Aborts the running summary; the returned promise settles once the durable
   * cancellation notice is persisted (or the operation failed otherwise).
   * Cancelling without a running summary is a no-op.
   */
  async cancel(sessionId: string): Promise<void> {
    const operation = this.operations.get(sessionId)
    if (!operation) return
    operation.controller.abort()
    await operation.promise
  }

  /** Whether one summary currently owns this session's per-session gate. */
  isCompacting(sessionId: string): boolean {
    return this.operations.has(sessionId)
  }

  /** Aborts every running summary; each operation then records its durable notice. */
  dispose(): void {
    this.isDisposed = true
    for (const operation of this.operations.values()) operation.controller.abort()
    this.textGeneration.dispose()
  }

  /**
   * Resolves when every running summary has settled, so shutdown can close the
   * database only after notices and checkpoints are durable. Persistence failures
   * survive operation settlement and are reported once per drain, then consumed.
   */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.operations.values()].map((operation) => operation.promise))
    const failures = this.pendingPersistenceFailures
    const failureCount = this.pendingPersistenceFailureCount
    this.pendingPersistenceFailures = []
    this.pendingPersistenceFailureCount = 0
    if (failureCount)
      throw new AggregateError(
        failures,
        `Failed to persist ${failureCount} conversation summary outcomes during shutdown; ${failures.length} error samples retained.`
      )
  }

  private async runOperation(
    sessionId: string,
    controller: AbortController,
    trigger: 'manual' | 'auto'
  ): Promise<SessionCompactionOutcome> {
    const signal = controller.signal
    this.dependencies.runtime.beginCompaction(sessionId)
    try {
      const source = this.dependencies.runtime.getCompactionSource(sessionId)
      if (!source) throw new CompactionRefused('No completed turns are available to summarize yet.')
      const capturedProfile = this.dependencies.runtime.getDefaultProfile(sessionId)
      try {
        const selection = this.dependencies.modelProfile.resolveForSession(sessionId)
        if (!selection.provider || !selection.configuration || !selection.modelEntryId)
          throw new Error('Select an enabled model for this session before summarizing.')
        const providerProfile = this.dependencies.modelProfile.toProfile(
          selection.configuration,
          selection.modelEntryId,
          'none'
        )
        const summary = await this.generateSummary({ provider: selection.provider, source, signal })
        signal.throwIfAborted()
        this.assertSourceUnchanged(sessionId, source)
        this.assertProfileUnchanged(sessionId, capturedProfile)
        const currentSelection = this.dependencies.modelProfile.resolveForSession(sessionId)
        if (
          !currentSelection.configuration ||
          !currentSelection.modelEntryId ||
          JSON.stringify(providerProfile) !==
            JSON.stringify(
              this.dependencies.modelProfile.toProfile(
                currentSelection.configuration,
                currentSelection.modelEntryId,
                'none'
              )
            )
        )
          throw new CompactionProfileChanged(
            'The provider configuration changed during summary generation. Start the summary again.'
          )
        signal.throwIfAborted()
        const { checkpointEventId } = this.dependencies.runtime.acceptContextCheckpoint({
          sessionId,
          summary,
          trigger,
          coverage: { throughSequence: source.throughSequence },
          sourceDigest: source.sourceDigest
        })
        return { status: 'accepted', checkpointEventId }
      } catch (error) {
        return this.settleFailure(
          sessionId,
          source,
          signal,
          error instanceof Error
            ? error
            : new Error('The summary could not be generated. Try summarizing again.')
        )
      }
    } finally {
      this.dependencies.runtime.endCompaction(sessionId)
    }
  }

  private async generateSummary({
    provider,
    source,
    signal
  }: {
    provider: ChatProvider
    source: CompactionSource
    signal: AbortSignal
  }): Promise<string> {
    const request = prepareTextInput({
      purpose: 'summary',
      instructions: createSessionSummaryInstructions(this.maxSummaryChars),
      history: source.messages,
      signal
    })
    return this.textGeneration.generate({ provider, request, maxOutputChars: this.maxSummaryChars })
  }

  private assertSourceUnchanged(sessionId: string, captured: CompactionSource): void {
    const current = this.dependencies.runtime.getCompactionSource(sessionId)
    if (
      !current ||
      current.throughSequence !== captured.throughSequence ||
      current.sourceDigest !== captured.sourceDigest
    )
      throw new CompactionSourceChanged(
        'The conversation changed while the summary was being generated. Start the summary again to cover the latest turns.'
      )
  }

  private assertProfileUnchanged(
    sessionId: string,
    captured: ExecutionProfileSnapshot | null
  ): void {
    const current = this.dependencies.runtime.getDefaultProfile(sessionId)
    if (JSON.stringify(current) !== JSON.stringify(captured))
      throw new CompactionProfileChanged(
        'The session model changed while the summary was being generated. Start the summary again.'
      )
  }

  private settleFailure(
    sessionId: string,
    source: CompactionSource,
    signal: AbortSignal,
    error: Error
  ): SessionCompactionOutcome {
    // Cancel wins even after an awaited failure: an aborted signal always
    // settles as a durable cancellation, whatever the underlying error was.
    if (signal.aborted) {
      this.recordNotice(sessionId, source, 'cancelled', 'The conversation summary was cancelled.')
      return { status: 'cancelled' }
    }
    const failure = toCompactionFailure(error)
    this.recordNotice(sessionId, source, failure.reason, failure.message)
    return { status: 'failed', message: failure.message }
  }

  private recordNotice(
    sessionId: string,
    source: CompactionSource,
    reason: CompactionNoticeReason,
    message: string
  ): void {
    try {
      this.dependencies.runtime.recordCompactionNotice({
        sessionId,
        coverage: { throughSequence: source.throughSequence },
        sourceDigest: source.sourceDigest,
        reason,
        message: message.slice(0, MAX_NOTICE_MESSAGE_CHARS)
      })
    } catch (error) {
      throw new CompactionPersistenceFailed(
        error instanceof Error
          ? error.message
          : 'Failed to persist the conversation summary outcome.',
        { cause: error }
      )
    }
  }
}

type CompactionFailure = { reason: CompactionNoticeReason; message: string }
function toCompactionFailure(error: Error): CompactionFailure {
  if (error instanceof CompactionSourceChanged)
    return { reason: 'source_changed', message: error.message }
  if (error instanceof CompactionProfileChanged)
    return { reason: 'profile_changed', message: error.message }
  if (error instanceof ProviderInputLimitExceeded)
    return { reason: 'rejected', message: error.message }
  if (error instanceof TextGenerationRejected)
    return {
      reason: 'rejected',
      message:
        error.reason === 'empty'
          ? 'The model returned an empty summary. Try summarizing again.'
          : `The conversation summary was rejected. ${error.message}`
    }
  return {
    reason: 'failed',
    message:
      error instanceof Error && error.message
        ? error.message
        : 'The summary could not be generated. Try summarizing again.'
  }
}

export { CompactionPersistenceFailed, SessionCompactor }
