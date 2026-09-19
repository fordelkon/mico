/** Stable, user-facing names for built-in tool capabilities. */
function toolLabel(toolName: string): string {
  return { bash: 'Run', edit: 'Edit', read: 'Read', write: 'Write' }[toolName] ?? toolName
}

export { toolLabel }
