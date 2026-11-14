type ToolIconKind = 'command' | 'edit' | 'write' | 'read' | 'search' | 'skill' | 'tool'

type ToolPresentation = {
  known: boolean
  label: string
  iconKind: ToolIconKind
  activityLabel: string
  completedSummary: { group: string; unit: string; verb: string }
}

// These identities are shared by invocation labels and activity summaries.
// Execution state, running messages, and detail projections retain their own owners.
const TOOL_PRESENTATIONS = {
  Bash: {
    label: 'Bash',
    iconKind: 'command',
    activityLabel: 'Running',
    completedSummary: { group: 'bash', unit: 'command', verb: 'Ran' }
  },
  Edit: {
    label: 'Update',
    iconKind: 'edit',
    activityLabel: 'Updating',
    completedSummary: { group: 'edit', unit: 'file', verb: 'Updated' }
  },
  Read: {
    label: 'Read',
    iconKind: 'read',
    activityLabel: 'Reading',
    completedSummary: { group: 'read', unit: 'file', verb: 'Read' }
  },
  Write: {
    label: 'Write',
    iconKind: 'write',
    activityLabel: 'Writing',
    completedSummary: { group: 'write', unit: 'file', verb: 'Wrote' }
  },
  Glob: {
    label: 'Glob',
    iconKind: 'search',
    activityLabel: 'Searching',
    completedSummary: { group: 'search', unit: 'pattern', verb: 'Searched' }
  },
  Grep: {
    label: 'Grep',
    iconKind: 'search',
    activityLabel: 'Searching',
    completedSummary: { group: 'search', unit: 'pattern', verb: 'Searched' }
  },
  LoadSkill: {
    label: 'Load skill',
    iconKind: 'skill',
    activityLabel: 'Loading skill',
    completedSummary: { group: 'LoadSkill', unit: 'call', verb: 'Load skill' }
  },
  ReadSkillResource: {
    label: 'Read skill resource',
    iconKind: 'read',
    activityLabel: 'Reading skill resource',
    completedSummary: { group: 'ReadSkillResource', unit: 'call', verb: 'Read skill resource' }
  }
} as const satisfies Record<string, Omit<ToolPresentation, 'known'>>

/** Unknown tools retain their name and generic details instead of impersonating a built-in. */
function getToolPresentation(toolName: string): ToolPresentation {
  if (Object.hasOwn(TOOL_PRESENTATIONS, toolName)) {
    // SAFETY: The own-property check above restricts the key to this table's built-in entries.
    const presentation = TOOL_PRESENTATIONS[toolName as keyof typeof TOOL_PRESENTATIONS]
    return { ...presentation, known: true }
  }
  return {
    known: false,
    label: toolName,
    iconKind: 'tool',
    activityLabel: toolName,
    completedSummary: { group: toolName, unit: 'call', verb: toolName }
  }
}

/** Stable names for built-in tool capabilities, shown in invocation labels like Bash(npm test). */
function toolLabel(toolName: string): string {
  return getToolPresentation(toolName).label
}

export { getToolPresentation, toolLabel }
