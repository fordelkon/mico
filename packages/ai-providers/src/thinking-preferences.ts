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

export { getOptimisticThinkingCapabilities, isOptimisticThinkingEffort }
