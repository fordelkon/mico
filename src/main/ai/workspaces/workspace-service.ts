import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { app } from 'electron'
import * as z from 'zod'

import { WorkspaceProjectSchema } from '@shared/data/schemas/workspace'

import { writeJsonAtomically } from '../../data/atomic-json'

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
  private catalog: WorkspaceCatalog | undefined
  constructor(dependencies: WorkspaceServiceDependencies = {}) {
    this.dependencies = { ...defaults, ...dependencies }
  }
  async initialize(): Promise<void> {
    await mkdir(this.getDefaultWorkspacePath(), { recursive: true })
    this.catalog = await this.readCatalog()
    if (this.catalog) return
    this.catalog = {
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
    await this.writeCatalog()
  }
  getDefaultWorkspacePath(): string {
    return join(this.dependencies.getUserDataPath(), 'workspaces', 'default')
  }
  listProjects(): WorkspaceProject[] {
    return this.requireCatalog()
      .projects.filter(({ archivedAt }) => archivedAt === null)
      .map((project) => this.toWorkspaceProject(project))
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
    const existing = this.requireCatalog().projects.find((project) => project.rootPath === rootPath)
    if (existing) {
      existing.archivedAt = null
      await this.writeCatalog()
      return this.toWorkspaceProject(existing)
    }
    const project = {
      id: this.dependencies.createId(),
      name: basename(rootPath),
      rootPath,
      archivedAt: null
    }
    this.requireCatalog().projects.push(project)
    await this.writeCatalog()
    return this.toWorkspaceProject(project)
  }
  async setDefaultProject(projectId: string): Promise<WorkspaceProject> {
    const project = this.requireActiveProject(projectId)
    this.requireCatalog().defaultProjectId = project.id
    await this.writeCatalog()
    return this.toWorkspaceProject(project)
  }
  async renameProject(projectId: string, name: string): Promise<WorkspaceProject> {
    const project = this.requireActiveProject(projectId)
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Project name is required.')
    project.name = trimmed
    await this.writeCatalog()
    return this.toWorkspaceProject(project)
  }
  async archiveProject(projectId: string): Promise<void> {
    if (this.requireCatalog().defaultProjectId === projectId)
      throw new Error('Choose another default project first.')
    this.requireActiveProject(projectId).archivedAt = this.dependencies.now()
    await this.writeCatalog()
  }
  getProjectContext(projectId: string): WorkspaceContext {
    const project = this.getProject(projectId)
    if (!project) throw new Error('Project does not exist.')
    return { kind: 'project', projectId: project.id, rootPath: project.rootPath }
  }
  resolvePath(context: WorkspaceContext, workspacePath: string): string {
    const resolvedPath = resolve(context.rootPath, workspacePath)
    const relativePath = relative(context.rootPath, resolvedPath)
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
      throw new Error('Workspace path must remain within its root.')
    return resolvedPath
  }
  private async resolveDirectory(directoryPath: string): Promise<string> {
    const resolved = await realpath(directoryPath)
    if (!(await stat(resolved)).isDirectory()) throw new Error('Project path must be a directory.')
    return resolved
  }
  private getProject(projectId: string): StoredWorkspaceProject | undefined {
    return this.requireCatalog().projects.find(({ id }) => id === projectId)
  }
  private requireActiveProject(projectId: string): StoredWorkspaceProject {
    const project = this.getProject(projectId)
    if (!project || project.archivedAt !== null) throw new Error('Project is unavailable.')
    return project
  }
  private requireCatalog(): WorkspaceCatalog {
    if (!this.catalog) throw new Error('Workspace service is not initialized.')
    return this.catalog
  }
  private toWorkspaceProject(project: StoredWorkspaceProject): WorkspaceProject {
    return {
      id: project.id,
      name: project.name,
      rootPath: project.rootPath,
      isDefault: project.id === this.requireCatalog().defaultProjectId
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
  private async writeCatalog(): Promise<void> {
    await writeJsonAtomically(this.catalogPath, this.requireCatalog())
  }
  private get catalogPath(): string {
    return join(this.dependencies.getUserDataPath(), 'workspace-projects.json')
  }
}
export { WorkspaceService }
export type { WorkspaceContext, WorkspaceProject, WorkspaceServiceDependencies }
