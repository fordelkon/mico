import {
  THINKING_SELECTIONS,
  type ModelReasoningCapabilities,
  type ThinkingSelection
} from './contracts'

const thinkingSelectionSet = new Set<string>(THINKING_SELECTIONS)

function isThinkingSelection(value: string): value is ThinkingSelection {
  return thinkingSelectionSet.has(value)
}

function normalizeCapabilities(
  efforts: readonly string[],
  defaultEffort: string
): ModelReasoningCapabilities | null {
  const selectableEfforts = Array.from(
    new Set(efforts.filter((effort): effort is ThinkingSelection => isThinkingSelection(effort)))
  )

  if (
    selectableEfforts.length < 2 ||
    !isThinkingSelection(defaultEffort) ||
    !selectableEfforts.includes(defaultEffort)
  ) {
    return null
  }

  return { availability: 'supported', selectableEfforts, defaultEffort }
}

function resolveThinkingSelection(
  selection: ThinkingSelection,
  capabilities: ModelReasoningCapabilities | null
): ThinkingSelection {
  return capabilities?.selectableEfforts.includes(selection) ? selection : 'default'
}

export { isThinkingSelection, normalizeCapabilities, resolveThinkingSelection }
