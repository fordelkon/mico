import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import { WorkspaceService } from './workspace-service'

describe('WorkspaceService', () => {
  const userDataPaths: string[] = []

  afterEach(async () => {
    await Promise.all(
      userDataPaths.splice(0).map((path) => rm(path, { force: true, recursive: true }))
    )
  })

  async function createService(options: ConstructorParameters<typeof WorkspaceService>[0] = {}) {
    const userDataPath = await mkdtemp(join(tmpdir(), 'mico-workspace-'))
    userDataPaths.push(userDataPath)
    const service = new WorkspaceService({ getUserDataPath: () => userDataPath, ...options })
    await service.initialize()
    return { service, userDataPath }
  }

  it('user gets a default workspace when initializing, then it lives beneath the user-data directory', async () => {
    const { service, userDataPath } = await createService()

    expect(service.getDefaultWorkspacePath()).toBe(join(userDataPath, 'workspaces', 'default'))
    expect((await stat(service.getDefaultWorkspacePath())).isDirectory()).toBe(true)
    expect(service.getDefaultWorkspaceContext()).toEqual({
      kind: 'project',
      projectId: 'default',
      rootPath: join(userDataPath, 'workspaces', 'default')
    })
  })

  it('user can re-add an archived project when adding its path again, then its rootPath is preserved', async () => {
    const { service, userDataPath } = await createService({ createId: () => 'project-1' })
    const projectPath = join(userDataPath, 'project')
    await mkdir(projectPath)
    const project = await service.addProject(projectPath)
    await service.archiveProject(project.id)

    expect(service.listProjects()).toEqual([
      expect.objectContaining({ id: 'default', isDefault: true })
    ])
    expect(service.getProjectContext(project.id)).toMatchObject({ rootPath: project.rootPath })

    expect(await service.addProject(projectPath)).toEqual({
      id: 'project-1',
      name: 'project',
      rootPath: project.rootPath,
      isDefault: false
    })
  })
})
