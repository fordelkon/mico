import type { SkillCatalog, SkillDocument } from '@shared/ai/skills'
import {
  createSkillSnapshot,
  skillCatalog,
  skillSettingsCatalog,
  type SkillSnapshot
} from '../skills'
import {
  WorkspaceCatalog,
  type WorkspaceContext,
  type WorkspaceProject,
  type WorkspacesDependencies
} from './catalog'
import { loadProjectInstructions } from './project-guidance'

/** Workspace sources are captured once; consumers compose policy and execution separately. */
interface WorkspaceSources {
  cwd: string
  skills: SkillSnapshot
  projectInstructions: string | null
  loadInvokedSkill(skillId: string, displayName: string): Promise<string>
}

/** Owns registered roots and their constrained source snapshots, without model execution. */
class Workspaces {
  private readonly catalog: WorkspaceCatalog

  constructor(dependencies: WorkspacesDependencies = {}) {
    this.catalog = new WorkspaceCatalog(dependencies)
  }

  initialize(): Promise<void> {
    return this.catalog.initialize()
  }

  getDefaultWorkspacePath(): string {
    return this.catalog.getDefaultWorkspacePath()
  }

  listProjects(): WorkspaceProject[] {
    return this.catalog.listProjects()
  }

  getDefaultWorkspaceContext(): WorkspaceContext {
    return this.catalog.getDefaultWorkspaceContext()
  }

  getActiveProjectContext(projectId: string): WorkspaceContext {
    return this.catalog.getActiveProjectContext(projectId)
  }

  getProjectContext(projectId: string): WorkspaceContext {
    return this.catalog.getProjectContext(projectId)
  }

  addProject(directoryPath: string): Promise<WorkspaceProject> {
    return this.catalog.addProject(directoryPath)
  }

  setDefaultProject(projectId: string): Promise<WorkspaceProject> {
    return this.catalog.setDefaultProject(projectId)
  }

  renameProject(projectId: string, name: string): Promise<WorkspaceProject> {
    return this.catalog.renameProject(projectId, name)
  }

  archiveProject(projectId: string): Promise<void> {
    return this.catalog.archiveProject(projectId)
  }

  async skillCatalog(projectId: string): Promise<SkillCatalog> {
    const { rootPath } = this.getProjectContext(projectId)
    return skillCatalog(await createSkillSnapshot(rootPath))
  }

  async skillSettingsCatalog(projectId: string): Promise<SkillCatalog> {
    const { rootPath } = this.getProjectContext(projectId)
    return skillSettingsCatalog(await createSkillSnapshot(rootPath))
  }

  async readSkillDocument(projectId: string, skillId: string): Promise<SkillDocument> {
    const { rootPath } = this.getProjectContext(projectId)
    return (await createSkillSnapshot(rootPath)).readDocument(skillId)
  }

  prepareSources(cwd: string): Promise<WorkspaceSources> {
    return Workspaces.prepareSources(cwd)
  }

  static async prepareSources(this: void, cwd: string): Promise<WorkspaceSources> {
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
}

export { Workspaces }
export type { WorkspaceSources }
