import type { ThinkingSelection } from './contracts'
import { isOptimisticThinkingEffort } from './thinking-preferences'

/**
 * One attempt's request aspects. Adapters apply these flags when building
 * their native request; the negotiator owns when each flag may be true.
 */
type RequestVariant = {
  includeThinking: boolean
  /** Use the provider's fallback request shape (for example, budget instead of adaptive thinking). */
  useFallbackThinking: boolean
  /** Use the fallback authentication variant (for example, bearer instead of x-api-key). */
  useFallbackAuth: boolean
}

type NegotiatedRequest = {
  /** The optimistic thinking selection, or null when the request never carries thinking. */
  thinkingEffort: ThinkingSelection | null
  attempt: (variant: RequestVariant) => Promise<Response>
}

/**
 * Owns the probe-reject-remember policy shared by optimistic providers.
 * Rejections are remembered on the provider instance (which is bound to one
 * endpoint and model), so later messages never pay the same rejected request:
 * authentication falls back at most once, the thinking request shape falls
 * back at most once, and a rejected thinking effort is remembered per effort.
 * A single send retries each remembered aspect once and never resends a
 * known-rejected variant; only parameter-validation responses (400/422)
 * identify an unsupported mapping, so authentication, rate-limit, and server
 * failures remain observable.
 */
function createRequestNegotiator(options: {
  supportsFallbackAuth: boolean
  supportsFallbackThinking: boolean
}) {
  const rejectedEfforts = new Set<ThinkingSelection>()
  let thinkingFallbackRejected = false
  let authRejected = false

  return async function send(request: NegotiatedRequest): Promise<Response> {
    const optimistic =
      request.thinkingEffort !== null &&
      isOptimisticThinkingEffort(request.thinkingEffort) &&
      !rejectedEfforts.has(request.thinkingEffort)
    const variant: RequestVariant = {
      includeThinking: optimistic,
      useFallbackThinking: thinkingFallbackRejected,
      useFallbackAuth: authRejected
    }
    let response = await request.attempt(variant)
    if (response.status === 401 && options.supportsFallbackAuth && !authRejected) {
      authRejected = true
      variant.useFallbackAuth = true
      response = await request.attempt(variant)
    }
    if ((response.status === 400 || response.status === 422) && variant.includeThinking) {
      if (options.supportsFallbackThinking && !thinkingFallbackRejected) {
        thinkingFallbackRejected = true
        variant.useFallbackThinking = true
      } else if (request.thinkingEffort !== null) {
        rejectedEfforts.add(request.thinkingEffort)
        variant.includeThinking = false
      } else {
        return response
      }
      response = await request.attempt(variant)
    }
    return response
  }
}

export { createRequestNegotiator }
export type { RequestVariant }
