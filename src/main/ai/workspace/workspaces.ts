import type { SkillCatalog, SkillDocument } from '@shared/ai/skills'
import { createProjectAgentInstructions } from './agent-instructions'
import {
  WorkspaceCatalog,
  type WorkspaceContext,
  type WorkspaceProject,
  type WorkspacesDependencies
} from './catalog'
import { loadProjectInstructions } from './project-guidance'
import { createSkillSnapshot, skillCatalog, skillSettingsCatalog } from './skills/snapshot'
import { ToolRegistry, type ToolRegistryOptions } from './tools/registry'

/** A turn captures guidance and skills once; resource reads remain on demand. */
type WorkspaceTurn = {
  registry: ToolRegistry
  projectInstructions: string | null
  systemInstructions(): string
  loadInvokedSkill(skillId: string, displayName: string): Promise<string>
}
type WorkspaceTurnOptions = Omit<ToolRegistryOptions, 'skills'>

/** Owns registered roots, their catalogs, and the capabilities available in a turn. */
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

  /** Existing conversations may still resolve their archived project's root. */
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

  enterTurn(cwd: string, options: WorkspaceTurnOptions = {}): Promise<WorkspaceTurn> {
    return Workspaces.enterTurn(cwd, options)
  }

  /** Also supports turns without a catalog service, using an already resolved root. */
  static async enterTurn(
    this: void,
    cwd: string,
    options: WorkspaceTurnOptions = {}
  ): Promise<WorkspaceTurn> {
    const [snapshot, projectInstructions] = await Promise.all([
      createSkillSnapshot(cwd),
      loadProjectInstructions(cwd)
    ])
    const registry = ToolRegistry.forWorkspace(cwd, { ...options, skills: snapshot })
    return {
      registry,
      projectInstructions,
      systemInstructions(): string {
        return createProjectAgentInstructions(cwd, registry.definitions, snapshot)
      },
      async loadInvokedSkill(skillId: string, displayName: string): Promise<string> {
        const body = await snapshot.loadForUser(skillId)
        if (snapshot.skills.find(({ id }) => id === skillId)?.name !== displayName)
          throw new Error(
            'The selected skill identity changed. Refresh the catalog and select it again.'
          )
        return body
      }
    }
  }
}

export { Workspaces }
export type { WorkspaceTurn, WorkspaceTurnOptions }
