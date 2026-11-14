import { APICallError } from '@ai-sdk/provider'
import { ProviderError } from '@mico/ai-providers'
import type { TurnFailure } from '@shared/ai/turn-failure'

class AgentBudgetError extends Error {
  readonly code: 'step_limit' | 'token_limit'

  constructor(code: 'step_limit' | 'token_limit', message: string) {
    super(message)
    this.code = code
  }
}

interface ProviderFailureClassification {
  failure: TurnFailure
  retryable: boolean
}

/** Provider failures are independent of session selection and workspace preparation. */
function classifyProviderFailure(error: Error): ProviderFailureClassification {
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
  if (error instanceof TypeError)
    return {
      failure: {
        code: 'provider_error',
        message: "Couldn't connect to the API endpoint. Check the API URL, network, VPN, or proxy."
      },
      retryable: true
    }
  if (!APICallError.isInstance(error))
    return {
      failure: {
        code: 'provider_error',
        message: "Couldn't generate a response. Please try again."
      },
      retryable: false
    }
  if (error.statusCode === 401 || error.statusCode === 403)
    return {
      failure: {
        code: 'provider_error',
        message:
          'Authentication failed for this provider. Check the API key and account permissions.'
      },
      retryable: false
    }
  if (error.statusCode === 404)
    return {
      failure: {
        code: 'provider_error',
        message: 'The selected model or API endpoint is unavailable. Check the provider settings.'
      },
      retryable: false
    }
  if (error.statusCode === 429)
    return {
      failure: {
        code: 'provider_error',
        message: 'The provider is rate limiting requests. Please try again shortly.'
      },
      retryable: error.isRetryable
    }
  if (error.statusCode !== undefined && error.statusCode >= 500)
    return {
      failure: {
        code: 'provider_error',
        message: 'The provider is temporarily unavailable. Please try again shortly.'
      },
      retryable: error.isRetryable
    }
  return {
    failure: { code: 'provider_error', message: "Couldn't generate a response. Please try again." },
    retryable: error.isRetryable
  }
}

export { AgentBudgetError, classifyProviderFailure }
export type { ProviderFailureClassification }
