/** Stable, user-facing names for built-in tool capabilities, shown in invocation labels like Bash(npm test). */
function toolLabel(toolName: string): string {
  return { bash: 'Bash', edit: 'Update', read: 'Read', write: 'Write' }[toolName] ?? toolName
}

export { toolLabel }
