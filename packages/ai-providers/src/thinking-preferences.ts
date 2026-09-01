import type { ModelReasoningCapabilities, ThinkingSelection } from './contracts'

// These adapters expose no per-model capability endpoint, so the UI keeps a
// stable five-level preference and learns unsupported native values at runtime.
const OPTIMISTIC_THINKING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh'] as const

function getOptimisticThinkingCapabilities(): ModelReasoningCapabilities {
  return {
    availability: 'unknown',
    selectableEfforts: [...OPTIMISTIC_THINKING_EFFORTS],
    defaultEffort: 'medium'
  }
}

function isOptimisticThinkingEffort(selection: ThinkingSelection): boolean {
  return OPTIMISTIC_THINKING_EFFORTS.some((effort) => effort === selection)
}

function createThinkingFallback() {
  // The provider instance is already bound to one endpoint and model. Keeping
  // failures here prevents each later message from paying the same rejected request.
  const unsupportedEfforts = new Set<ThinkingSelection>()

  return async function fetchWithThinkingFallback(
    selection: ThinkingSelection,
    send: (includeThinking: boolean) => Promise<Response>
  ): Promise<Response> {
    if (!isOptimisticThinkingEffort(selection) || unsupportedEfforts.has(selection)) {
      return send(false)
    }

    const response = await send(true)
    // Only parameter-validation responses can identify an unsupported mapping;
    // authentication, rate-limit, and server failures must remain observable.
    if (response.status !== 400 && response.status !== 422) return response

    unsupportedEfforts.add(selection)
    return send(false)
  }
}

export { createThinkingFallback, getOptimisticThinkingCapabilities, isOptimisticThinkingEffort }
