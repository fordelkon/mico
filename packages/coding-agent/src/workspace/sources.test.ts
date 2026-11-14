import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareWorkspaceSources } from './sources'

describe('prepareWorkspaceSources', () => {
  const directories: string[] = []
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((cwd) => rm(cwd, { recursive: true, force: true })))
  })

  it('user changes guidance when a snapshot exists, then its captured sources remain stable', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'mico-sources-'))
    directories.push(cwd)
    const base = join(cwd, '.agents', 'skills', 'review')
    await mkdir(base, { recursive: true })
    const path = join(base, 'SKILL.md')
    await writeFile(
      path,
      '---\nname: review\ndescription: Original description\n---\nOriginal body'
    )
    await writeFile(join(cwd, 'AGENTS.md'), 'Original guidance')
    const turn = await prepareWorkspaceSources(cwd)
    await writeFile(path, '---\nname: review\ndescription: Changed description\n---\nChanged body')
    await writeFile(join(cwd, 'AGENTS.md'), 'Changed guidance')

    expect(turn.projectInstructions).toContain('Original guidance')
    expect(turn.skills.skills.find((skill) => skill.name === 'review')?.description).toBe(
      'Original description'
    )
    expect(await turn.loadInvokedSkill('project-agents:review', 'review')).toContain(
      'Original body'
    )
    expect(await turn.skills.load('project-agents:review')).toContain('Original body')
    const refreshed = await prepareWorkspaceSources(cwd)
    expect(refreshed.projectInstructions).toContain('Changed guidance')
    expect(await refreshed.loadInvokedSkill('project-agents:review', 'review')).toContain(
      'Changed body'
    )
  })

  it('user invokes a stale identity when a turn starts, then names cannot select another skill', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'mico-sources-'))
    directories.push(cwd)
    const base = join(cwd, '.agents', 'skills', 'review')
    await mkdir(base, { recursive: true })
    await writeFile(
      join(base, 'SKILL.md'),
      '---\nname: review\ndescription: Review\n---\nInstructions'
    )
    const turn = await prepareWorkspaceSources(cwd)

    await expect(turn.loadInvokedSkill('review', 'review')).rejects.toThrow('Unknown skill')
    await expect(turn.loadInvokedSkill('project-agents:review', 'renamed')).rejects.toThrow(
      'The selected skill identity changed.'
    )
  })
})
