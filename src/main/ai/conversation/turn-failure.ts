import type { TurnFailure } from '@shared/ai/turn-failure'
import { AgentBudgetError, classifyProviderFailure } from '../execution'
import { ModelSelectionError } from '../models'
import { ContextAdmissionError } from './auto-compaction'

class SkillInvocationError extends Error {}
type TurnFailureClassification = { failure: TurnFailure; retryable: boolean }

/** Session preparation errors are mapped here; provider retry policy belongs to execution. */
function toTurnFailure(error: Error): TurnFailureClassification {
  if (error instanceof SkillInvocationError || error instanceof ContextAdmissionError)
    return { failure: { code: 'provider_error', message: error.message }, retryable: false }
  if (error instanceof ModelSelectionError)
    return { failure: { code: 'no_model', message: error.message }, retryable: false }
  if (error instanceof AgentBudgetError)
    return { failure: { code: error.code, message: error.message }, retryable: false }
  return classifyProviderFailure(error)
}

export { AgentBudgetError, SkillInvocationError, toTurnFailure }
export type { TurnFailureClassification }
