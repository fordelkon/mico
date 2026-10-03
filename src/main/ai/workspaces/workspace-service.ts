import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { app } from 'electron'
import * as z from 'zod'

import { WorkspaceProjectSchema } from '@shared/data/schemas/workspace'

import { JsonDocument } from '../../data/atomic-json'

type StoredWorkspaceProject = {
  id: string
  name: string
  rootPath: string
  archivedAt: number | null
}
type WorkspaceProject = { id: string; name: string; rootPath: string; isDefault: boolean }
type WorkspaceContext = { kind: 'project'; projectId: string; rootPath: string }
type WorkspaceCatalog = { defaultProjectId: string; projects: StoredWorkspaceProject[]; version: 1 }
type WorkspaceServiceDependencies = {
  createId?: () => string
  getUserDataPath?: () => string
  now?: () => number
}
const PersistedWorkspaceProjectSchema = WorkspaceProjectSchema.extend({
  archivedAt: z.number().int().nonnegative().nullable()
}).omit({ isDefault: true })
const WorkspaceCatalogSchema = z.object({
  defaultProjectId: z.string().trim().min(1),
  projects: z.array(PersistedWorkspaceProjectSchema),
  version: z.literal(1)
})
const defaults: Required<WorkspaceServiceDependencies> = {
  createId: randomUUID,
  getUserDataPath: () => app.getPath('userData'),
  now: Date.now
}

class WorkspaceService {
  private readonly dependencies: Required<WorkspaceServiceDependencies>
  private document: JsonDocument<WorkspaceCatalog> | undefined
  constructor(dependencies: WorkspaceServiceDependencies = {}) {
    this.dependencies = { ...defaults, ...dependencies }
  }
  async initialize(): Promise<void> {
    await mkdir(this.getDefaultWorkspacePath(), { recursive: true })
    const saved = await this.readCatalog()
    this.document = new JsonDocument(
      this.catalogPath,
      saved ?? {
        version: 1,
        defaultProjectId: 'default',
        projects: [
          {
            id: 'default',
            name: 'Default',
            rootPath: this.getDefaultWorkspacePath(),
            archivedAt: null
          }
        ]
      }
    )
    if (!saved) await this.document.update((catalog) => catalog)
  }
  getDefaultWorkspacePath(): string {
    return join(this.dependencies.getUserDataPath(), 'workspaces', 'default')
  }
  listProjects(): WorkspaceProject[] {
    const catalog = this.requireCatalog()
    return catalog.projects
      .filter(({ archivedAt }) => archivedAt === null)
      .map((project) => this.toWorkspaceProject(project, catalog))
  }
  getDefaultWorkspaceContext(): WorkspaceContext {
    return this.getProjectContext(this.requireCatalog().defaultProjectId)
  }
  getActiveProjectContext(projectId: string): WorkspaceContext {
    const project = this.requireActiveProject(projectId)
    return { kind: 'project', projectId: project.id, rootPath: project.rootPath }
  }
  async addProject(directoryPath: string): Promise<WorkspaceProject> {
    const rootPath = await this.resolveDirectory(directoryPath)
    const committed = await this.requireDocument().update((catalog) => {
      const existing = catalog.projects.find((project) => project.rootPath === rootPath)
      if (existing) existing.archivedAt = null
      else
        catalog.projects.push({
          id: this.dependencies.createId(),
          name: basename(rootPath),
          rootPath,
          archivedAt: null
        })
      return catalog
    })
    const project = committed.projects.find((candidate) => candidate.rootPath === rootPath)
    if (!project) throw new Error('Added project is unavailable.')
    return this.toWorkspaceProject(project, committed)
  }
  async setDefaultProject(projectId: string): Promise<WorkspaceProject> {
    const committed = await this.requireDocument().update((catalog) => {
      catalog.defaultProjectId = this.requireActiveProject(projectId, catalog).id
      return catalog
    })
    return this.toWorkspaceProject(this.requireActiveProject(projectId, committed), committed)
  }
  async renameProject(projectId: string, name: string): Promise<WorkspaceProject> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Project name is required.')
    const committed = await this.requireDocument().update((catalog) => {
      this.requireActiveProject(projectId, catalog).name = trimmed
      return catalog
    })
    return this.toWorkspaceProject(this.requireActiveProject(projectId, committed), committed)
  }
  async archiveProject(projectId: string): Promise<void> {
    await this.requireDocument().update((catalog) => {
      if (catalog.defaultProjectId === projectId)
        throw new Error('Choose another default project first.')
      this.requireActiveProject(projectId, catalog).archivedAt = this.dependencies.now()
      return catalog
    })
  }
  getProjectContext(projectId: string): WorkspaceContext {
    const project = this.getProject(projectId)
    if (!project) throw new Error('Project does not exist.')
    return { kind: 'project', projectId: project.id, rootPath: project.rootPath }
  }
  private async resolveDirectory(directoryPath: string): Promise<string> {
    const resolved = await realpath(directoryPath)
    if (!(await stat(resolved)).isDirectory()) throw new Error('Project path must be a directory.')
    return resolved
  }
  private getProject(projectId: string): StoredWorkspaceProject | undefined {
    return this.requireCatalog().projects.find(({ id }) => id === projectId)
  }
  private requireActiveProject(
    projectId: string,
    catalog = this.requireCatalog()
  ): StoredWorkspaceProject {
    const project = catalog.projects.find(({ id }) => id === projectId)
    if (!project || project.archivedAt !== null) throw new Error('Project is unavailable.')
    return project
  }
  private requireCatalog(): WorkspaceCatalog {
    return this.requireDocument().value
  }
  private requireDocument(): JsonDocument<WorkspaceCatalog> {
    if (!this.document) throw new Error('Workspace service is not initialized.')
    return this.document
  }
  private toWorkspaceProject(
    project: StoredWorkspaceProject,
    catalog = this.requireCatalog()
  ): WorkspaceProject {
    return {
      id: project.id,
      name: project.name,
      rootPath: project.rootPath,
      isDefault: project.id === catalog.defaultProjectId
    }
  }
  private async readCatalog(): Promise<WorkspaceCatalog | undefined> {
    try {
      const value: unknown = JSON.parse(await readFile(this.catalogPath, 'utf8'))
      const parsed = WorkspaceCatalogSchema.safeParse(value)
      return parsed.success ? parsed.data : undefined
    } catch {
      return undefined
    }
  }
  private get catalogPath(): string {
    return join(this.dependencies.getUserDataPath(), 'workspace-projects.json')
  }
}
export { WorkspaceService }
export type { WorkspaceContext, WorkspaceProject, WorkspaceServiceDependencies }
