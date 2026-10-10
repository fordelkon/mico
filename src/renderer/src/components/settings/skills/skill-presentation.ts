import type { SkillSource } from '@shared/ai/skills'

const sourceLabels = {
  'project-agents': 'Workspace · .agents',
  'project-claude': 'Workspace · .claude',
  'user-agents': 'User · .agents',
  'user-claude': 'User · .claude'
} satisfies Record<SkillSource, string>

function loadError(message: string, subject: string): string {
  const detail = message ? ` ${message}` : ''
  return `${subject} could not be loaded.${detail} Retry, or refresh the catalog if the files have changed.`
}

export { sourceLabels, loadError }
