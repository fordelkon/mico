import type { TurnFailure } from '../contracts'
import { OutputTokenLimitError } from '@mico/agent-core'
import { APICallError } from '@ai-sdk/provider'
import { ProviderError } from '@mico/ai-providers'
import { ModelSelectionError } from './model-selection'
import { ContextAdmissionError } from './auto-compaction'

class SkillInvocationError extends Error {}

/** Session preparation errors are mapped here; provider retry policy belongs to execution. */
function toTurnFailure(error: Error): TurnFailure {
  if (error instanceof SkillInvocationError || error instanceof ContextAdmissionError)
    return { code: 'provider_error', message: error.message }
  if (error instanceof ModelSelectionError) return { code: 'no_model', message: error.message }
  if (error instanceof OutputTokenLimitError) return { code: 'token_limit', message: error.message }
  return { code: 'provider_error', message: providerFailureMessage(error) }
}

function providerFailureMessage(error: Error): string {
  const status =
    error instanceof ProviderError
      ? error.status
      : APICallError.isInstance(error)
        ? error.statusCode
        : undefined
  if (status === 401 || status === 403)
    return 'Authentication failed for this provider. Check the API key and account permissions.'
  if (status === 404)
    return 'The selected model or API endpoint is unavailable. Check the provider settings.'
  if (error instanceof ProviderError) return error.message
  if (error instanceof TypeError)
    return "Couldn't connect to the API endpoint. Check the API URL, network, VPN, or proxy."
  if (status === 429) return 'The provider is rate limiting requests. Please try again shortly.'
  if (status !== undefined && status >= 500)
    return 'The provider is temporarily unavailable. Please try again shortly.'
  return "Couldn't generate a response. Please try again."
}

export { SkillInvocationError, toTurnFailure }
