/** Stable, user-facing names for built-in tool capabilities, shown in invocation labels like Bash(npm test). */
function toolLabel(toolName: string): string {
  return (
    {
      Bash: 'Bash',
      Edit: 'Update',
      Read: 'Read',
      Write: 'Write',
      Glob: 'Glob',
      Grep: 'Grep',
      LoadSkill: 'Load skill',
      ReadSkillResource: 'Read skill resource'
    }[toolName] ?? toolName
  )
}

export { toolLabel }
