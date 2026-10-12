import type { SkillSource } from '@shared/ai/skills'

const sourceLabels = {
  'project-agents': 'Workspace · .agents',
  'project-claude': 'Workspace · .claude',
  'project-gemini': 'Workspace · .gemini',
  'project-cursor': 'Workspace · .cursor',
  'project-github': 'Workspace · .github',
  'project-skills': 'Workspace · skills',
  'user-agents': 'User · .agents',
  'user-claude': 'User · .claude',
  'user-config-agents': 'User · .config/agents',
  'user-codex': 'User · .codex',
  'user-cursor': 'User · .cursor',
  'user-gemini': 'User · .gemini'
} satisfies Record<SkillSource, string>

function loadError(message: string, subject: string): string {
  const detail = message ? ` ${message}` : ''
  return `${subject} could not be loaded.${detail} Retry, or refresh the catalog if the files have changed.`
}

export { sourceLabels, loadError }
