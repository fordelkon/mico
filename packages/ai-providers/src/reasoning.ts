import type { ModelReasoningCapabilities, ThinkingSelection } from './contracts'

function resolveThinkingSelection(
  selection: ThinkingSelection,
  capabilities: ModelReasoningCapabilities | null
): ThinkingSelection {
  if (!capabilities) return 'none'
  return capabilities.selectableEfforts.includes(selection) ? selection : 'default'
}

export { resolveThinkingSelection }
