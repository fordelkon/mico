import { APICallError } from '@ai-sdk/provider'
import { ProviderError } from '@mico/ai-providers'
import { ModelSelectionError } from '../models'

import type { TurnFailure } from '@shared/ai/turn-failure'

/** The model hit a bounded budget — steps or output tokens — mid-turn. */
class AgentBudgetError extends Error {
  readonly code: 'step_limit' | 'token_limit'

  constructor(code: 'step_limit' | 'token_limit', message: string) {
    super(message)
    this.code = code
  }
}

class SkillInvocationError extends Error {}
type TurnFailureClassification = { failure: TurnFailure; retryable: boolean }

/**
 * Classify a thrown failure once at the orchestration seam: tools and
 * providers keep throwing internally, and this encodes the turn-level result.
 * The returned message is user-facing copy; `retryable` drives the retry loop.
 */
function toTurnFailure(error: Error): TurnFailureClassification {
  if (error instanceof SkillInvocationError)
    return { failure: { code: 'provider_error', message: error.message }, retryable: false }

  if (error instanceof ModelSelectionError)
    return { failure: { code: 'no_model', message: error.message }, retryable: false }

  if (error instanceof AgentBudgetError)
    return { failure: { code: error.code, message: error.message }, retryable: false }

  if (error instanceof ProviderError) {
    const retryable =
      error.kind === 'transport' ||
      error.kind === 'incomplete_stream' ||
      error.kind === 'rate_limit' ||
      (error.kind === 'http' &&
        error.status !== undefined &&
        (error.status === 408 || error.status >= 500))
    const message =
      error.status === 401 || error.status === 403
        ? 'Authentication failed for this provider. Check the API key and account permissions.'
        : error.status === 404
          ? 'The selected model or API endpoint is unavailable. Check the provider settings.'
          : error.message
    return { failure: { code: 'provider_error', message }, retryable }
  }

  if (error instanceof TypeError) {
    return {
      failure: {
        code: 'provider_error',
        message: "Couldn't connect to the API endpoint. Check the API URL, network, VPN, or proxy."
      },
      retryable: true
    }
  }

  if (!APICallError.isInstance(error)) {
    return {
      failure: {
        code: 'provider_error',
        message: "Couldn't generate a response. Please try again."
      },
      retryable: false
    }
  }

  if (error.statusCode === 401 || error.statusCode === 403) {
    return {
      failure: {
        code: 'provider_error',
        message:
          'Authentication failed for this provider. Check the API key and account permissions.'
      },
      retryable: false
    }
  }

  if (error.statusCode === 404) {
    return {
      failure: {
        code: 'provider_error',
        message: 'The selected model or API endpoint is unavailable. Check the provider settings.'
      },
      retryable: false
    }
  }

  if (error.statusCode === 429) {
    return {
      failure: {
        code: 'provider_error',
        message: 'The provider is rate limiting requests. Please try again shortly.'
      },
      retryable: error.isRetryable
    }
  }

  if (error.statusCode !== undefined && error.statusCode >= 500) {
    return {
      failure: {
        code: 'provider_error',
        message: 'The provider is temporarily unavailable. Please try again shortly.'
      },
      retryable: error.isRetryable
    }
  }

  return {
    failure: { code: 'provider_error', message: "Couldn't generate a response. Please try again." },
    retryable: error.isRetryable
  }
}

export type { TurnFailureClassification }
export { AgentBudgetError, SkillInvocationError, toTurnFailure }
