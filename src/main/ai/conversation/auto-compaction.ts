import type { ThinkingSelection } from '@mico/ai-providers'
import type { SessionCompactor } from './compaction'
import { prepareProviderInput } from '../context'
import type { SessionRuntimeService } from './runtime'
import type { CapturedTurnContext } from './turn-context'

const DEFAULT_APPLICATION_INPUT_BUDGET_TOKENS = 48_000

class ContextAdmissionError extends Error {}

/** An application policy limit, independent of any provider's actual context capacity. */
class ContextBudgetExceeded extends ContextAdmissionError {
  constructor(
    readonly estimatedInputTokens: number,
    readonly applicationInputBudgetTokens: number
  ) {
    super(
      `The prepared request is estimated at ${estimatedInputTokens} input tokens, above the ${applicationInputBudgetTokens}-token application input budget. Automatic compaction could not reduce it enough. Shorten the request or start a new conversation with the relevant details. This budget is not the model's context window.`
    )
    this.name = 'ContextBudgetExceeded'
  }
}

interface PendingContextOptions {
  sessionId: string
  budget: number | false
  captured: CapturedTurnContext
  replay: () => ReturnType<SessionRuntimeService['previewTurn']>['replayMessages']
  runtime: Pick<SessionRuntimeService, 'getCompactionSource' | 'getLatestCheckpointCoverage'>
  compactor: Pick<SessionCompactor, 'compact'> | undefined
  thinkingEffort: ThinkingSelection
  signal: AbortSignal
}

/** At most one dedicated summary request; acceptance and pinning happen only after this returns. */
async function compactPendingContext(options: PendingContextOptions): Promise<void> {
  const { sessionId, budget, captured, replay, runtime, compactor, thinkingEffort, signal } =
    options
  if (budget === false) return
  const estimate = (): number => {
    const context = captured.project(replay())
    return prepareProviderInput({
      purpose: 'turn',
      history: context.history,
      prepareMessages: context.messages,
      toolContext: context.registry,
      thinkingEffort,
      signal
    }).measurement.estimatedInputTokens
  }
  let estimated = estimate()
  if (estimated <= budget) return
  const source = runtime.getCompactionSource(sessionId)
  if (
    compactor &&
    source &&
    source.throughSequence > runtime.getLatestCheckpointCoverage(sessionId)
  ) {
    const outcome = await compactor.compact(sessionId, { trigger: 'auto', signal })
    signal.throwIfAborted()
    if (outcome.status !== 'accepted')
      throw new ContextAdmissionError(
        outcome.status === 'failed'
          ? `Automatic compaction failed before the request was accepted. ${outcome.message}`
          : 'Automatic compaction was cancelled before the request was accepted.'
      )
    estimated = estimate()
    if (estimated <= budget) return
  }
  throw new ContextBudgetExceeded(estimated, budget)
}

function validateApplicationInputBudget(value: number | false): number | false {
  if (value !== false && (!Number.isSafeInteger(value) || value <= 0))
    throw new Error('The application input budget must be a positive safe integer or false.')
  return value
}

export {
  compactPendingContext,
  ContextAdmissionError,
  ContextBudgetExceeded,
  DEFAULT_APPLICATION_INPUT_BUDGET_TOKENS,
  validateApplicationInputBudget
}
