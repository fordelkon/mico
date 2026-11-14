import { createSkillSnapshot, type SkillSnapshot } from '../skills/snapshot'
import { loadProjectInstructions } from './project-guidance'

/** Workspace sources are captured once; consumers compose policy and execution separately. */
interface WorkspaceSources {
  cwd: string
  skills: SkillSnapshot
  projectInstructions: string | null
  loadInvokedSkill(skillId: string, displayName: string): Promise<string>
}

async function prepareWorkspaceSources(cwd: string): Promise<WorkspaceSources> {
  const [skills, projectInstructions] = await Promise.all([
    createSkillSnapshot(cwd),
    loadProjectInstructions(cwd)
  ])
  return {
    cwd,
    skills,
    projectInstructions,
    async loadInvokedSkill(skillId: string, displayName: string): Promise<string> {
      const body = await skills.loadForUser(skillId)
      if (skills.skills.find(({ id }) => id === skillId)?.name !== displayName)
        throw new Error(
          'The selected skill identity changed. Refresh the catalog and select it again.'
        )
      return body
    }
  }
}

export { prepareWorkspaceSources }
export type { WorkspaceSources }
