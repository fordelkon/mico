import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import { Workspaces } from './index'

describe('Workspaces', () => {
  const userDataPaths: string[] = []

  afterEach(async () => {
    await Promise.all(
      userDataPaths.splice(0).map((path) => rm(path, { force: true, recursive: true }))
    )
  })

  async function createService(options: ConstructorParameters<typeof Workspaces>[0] = {}) {
    const userDataPath = await mkdtemp(join(tmpdir(), 'mico-workspace-'))
    userDataPaths.push(userDataPath)
    const service = new Workspaces({ getUserDataPath: () => userDataPath, ...options })
    await service.initialize()
    return { service, userDataPath }
  }

  it('user overlaps workspace renames when saving, then the last name survives restart', async () => {
    const { service, userDataPath } = await createService()
    await Promise.all([
      service.renameProject('default', 'First'),
      service.renameProject('default', 'Last')
    ])
    const restored = new Workspaces({ getUserDataPath: () => userDataPath })
    await restored.initialize()
    expect(restored.listProjects()).toEqual([
      {
        id: 'default',
        name: 'Last',
        rootPath: join(userDataPath, 'workspaces', 'default'),
        isDefault: true
      }
    ])
  })

  it('user retries after a failed workspace save when storage recovers, then only committed names appear', async () => {
    const { service, userDataPath } = await createService()
    const filePath = join(userDataPath, 'workspace-projects.json')
    await rm(filePath)
    await mkdir(filePath)
    await expect(service.renameProject('default', 'Rejected')).rejects.toThrow(
      /EPERM|EISDIR|EACCES|ENOTEMPTY/
    )
    expect(service.listProjects()[0].name).toBe('Default')
    await rm(filePath, { recursive: true })
    await service.renameProject('default', 'Recovered')
    const restored = new Workspaces({ getUserDataPath: () => userDataPath })
    await restored.initialize()
    expect(restored.listProjects()[0].name).toBe('Recovered')
  })

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

  it('user changes guidance when a turn exists, then tools and invocation keep its captured contents', async () => {
    const { service } = await createService()
    const cwd = service.getDefaultWorkspacePath()
    const base = join(cwd, '.agents', 'skills', 'review')
    await mkdir(base, { recursive: true })
    const path = join(base, 'SKILL.md')
    await writeFile(
      path,
      '---\nname: review\ndescription: Original description\n---\nOriginal body'
    )
    await writeFile(join(cwd, 'AGENTS.md'), 'Original guidance')
    const turn = await service.enterTurn(cwd)
    await writeFile(path, '---\nname: review\ndescription: Changed description\n---\nChanged body')
    await writeFile(join(cwd, 'AGENTS.md'), 'Changed guidance')

    expect(turn.projectInstructions).toContain('Original guidance')
    expect(turn.systemInstructions()).toContain('Original description')
    expect(await turn.loadInvokedSkill('project-agents:review', 'review')).toContain(
      'Original body'
    )
    const execution = await turn.registry.execute(
      { toolCallId: 'load', toolName: 'LoadSkill', input: { skill_id: 'project-agents:review' } },
      new AbortController().signal
    )
    expect(execution.result).toMatchObject({
      isError: false,
      output: expect.stringContaining('Original body')
    })
    const refreshed = await Workspaces.enterTurn(cwd)
    expect(refreshed.projectInstructions).toContain('Changed guidance')
    expect(await refreshed.loadInvokedSkill('project-agents:review', 'review')).toContain(
      'Changed body'
    )
  })

  it('user browses an archived project when skills change, then catalogs and documents reflect its registered root', async () => {
    const { service, userDataPath } = await createService({ createId: () => 'project-1' })
    const projectPath = join(userDataPath, 'project')
    await mkdir(projectPath)
    const project = await service.addProject(projectPath)
    const base = join(projectPath, '.agents', 'skills', 'workspace-only')
    await mkdir(base, { recursive: true })
    const path = join(base, 'SKILL.md')
    await writeFile(
      path,
      '---\nname: workspace-only\ndescription: Model only\nuser-invocable: false\n---\nOriginal body'
    )
    await service.archiveProject(project.id)

    const composer = await service.skillCatalog(project.id)
    expect(composer.skills.find(({ id }) => id === 'project-agents:workspace-only')).toBeUndefined()
    const settings = await service.skillSettingsCatalog(project.id)
    expect(settings.skills.find(({ id }) => id === 'project-agents:workspace-only')).toMatchObject({
      userInvocable: false,
      source: 'project-agents'
    })
    await writeFile(
      path,
      '---\nname: workspace-only\ndescription: Updated\nuser-invocable: false\n---\nChanged body'
    )
    expect(
      await service.readSkillDocument(project.id, 'project-agents:workspace-only')
    ).toMatchObject({ body: 'Changed body' })
    await expect(service.skillCatalog(projectPath)).rejects.toThrow('Project does not exist.')
  })

  it('user invokes a stale identity when a turn starts, then names cannot select another skill', async () => {
    const { service } = await createService()
    const cwd = service.getDefaultWorkspacePath()
    const base = join(cwd, '.agents', 'skills', 'review')
    await mkdir(base, { recursive: true })
    await writeFile(
      join(base, 'SKILL.md'),
      '---\nname: review\ndescription: Review\n---\nInstructions'
    )
    const turn = await Workspaces.enterTurn(cwd)

    await expect(turn.loadInvokedSkill('review', 'review')).rejects.toThrow('Unknown skill')
    await expect(turn.loadInvokedSkill('project-agents:review', 'renamed')).rejects.toThrow(
      'The selected skill identity changed.'
    )
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
    expect(() => service.getActiveProjectContext(project.id)).toThrow('Project is unavailable.')

    expect(await service.addProject(projectPath)).toEqual({
      id: 'project-1',
      name: 'project',
      rootPath: project.rootPath,
      isDefault: false
    })
  })
})
