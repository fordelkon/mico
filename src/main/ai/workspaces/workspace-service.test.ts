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

  it('creates the default workspace beneath the platform user-data directory', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'mico-workspace-'))
    userDataPaths.push(userDataPath)
    const service = new WorkspaceService({ getUserDataPath: () => userDataPath })

    await service.initialize()

    expect(service.getDefaultWorkspacePath()).toBe(join(userDataPath, 'workspaces', 'default'))
    expect((await stat(service.getDefaultWorkspacePath())).isDirectory()).toBe(true)
  })

  it('resolves default workspace paths without allowing an escape from its root', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'mico-workspace-'))
    userDataPaths.push(userDataPath)
    const service = new WorkspaceService({ getUserDataPath: () => userDataPath })

    await service.initialize()

    expect(service.getDefaultWorkspaceContext()).toEqual({
      kind: 'project',
      projectId: 'default',
      rootPath: join(userDataPath, 'workspaces', 'default')
    })
    expect(service.resolvePath(service.getDefaultWorkspaceContext(), 'notes/today.md')).toBe(
      join(userDataPath, 'workspaces', 'default', 'notes', 'today.md')
    )
    expect(() =>
      service.resolvePath(service.getDefaultWorkspaceContext(), '../outside.txt')
    ).toThrow('Workspace path must remain within its root.')
  })

  it('restores an archived path without changing historical access to it', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'mico-workspace-'))
    const projectPath = join(userDataPath, 'project')
    userDataPaths.push(userDataPath)
    await mkdir(projectPath)
    const service = new WorkspaceService({
      createId: () => 'project-1',
      getUserDataPath: () => userDataPath
    })

    await service.initialize()
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
