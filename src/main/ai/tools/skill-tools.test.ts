import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createSkillSnapshot } from '../skills'
import { createTemporaryWorkspace, removeTemporaryPaths } from './test-helpers'
import { type ToolCall, ToolRegistry } from './tool-registry'

afterEach(removeTemporaryPaths)

describe('skill tools', () => {
  it('user selects a manual skill when tools run, then only that request gains access', async () => {
    const cwd = await createTemporaryWorkspace('mico-manual-skill-')
    const home = await createTemporaryWorkspace('mico-manual-home-')
    const base = join(cwd, '.agents/skills/manual')
    await mkdir(base, { recursive: true })
    await writeFile(
      join(base, 'SKILL.md'),
      '---\nname: manual\ndescription: Manual\ndisable-model-invocation: true\n---\nPrivate instructions'
    )
    await writeFile(join(base, 'reference.md'), 'Manual reference')
    const snapshot = await createSkillSnapshot(cwd, home)
    const signal = new AbortController().signal
    const blocked = ToolRegistry.forWorkspace(cwd, { skills: snapshot })
    const authorized = ToolRegistry.forWorkspace(cwd, {
      skills: snapshot,
      authorizedSkillIds: ['project-agents:manual']
    })
    const calls: ToolCall[] = [
      { toolCallId: 'load', toolName: 'LoadSkill', input: { skill_id: 'manual' } },
      {
        toolCallId: 'resource',
        toolName: 'ReadSkillResource',
        input: { skill_id: 'manual', relative_path: 'reference.md' }
      }
    ]
    for (const call of calls) {
      expect((await blocked.execute(call, signal)).result).toMatchObject({
        isError: true,
        output: expect.stringContaining('explicit user invocation')
      })
      expect((await authorized.execute(call, signal)).result).toMatchObject({ isError: false })
      expect((await blocked.execute(call, signal)).result.isError).toBe(true)
    }
  })

  it('user invokes a skill when it lives outside the workspace, then only scoped resources are readable', async () => {
    const cwd = await createTemporaryWorkspace('mico-skill-workspace-')
    const home = await createTemporaryWorkspace('mico-skill-home-')
    const base = join(home, '.agents', 'skills', 'review')
    await mkdir(base, { recursive: true })
    await writeFile(
      join(base, 'SKILL.md'),
      '---\nname: review\ndescription: Review code\n---\nInspect before editing.'
    )
    await writeFile(join(base, 'reference.md'), 'Reference text')
    const snapshot = await createSkillSnapshot(cwd, home)
    const registry = ToolRegistry.forWorkspace(cwd, { skills: snapshot })
    const signal = new AbortController().signal
    const loaded = await registry.execute(
      { toolCallId: 'load', toolName: 'LoadSkill', input: { skill_id: 'user-agents:review' } },
      signal
    )
    const resource = await registry.execute(
      {
        toolCallId: 'resource',
        toolName: 'ReadSkillResource',
        input: { skill_id: 'user-agents:review', relative_path: 'reference.md' }
      },
      signal
    )
    const generic = await registry.execute(
      { toolCallId: 'generic', toolName: 'Read', input: { file_path: join(base, 'reference.md') } },
      signal
    )
    const escape = await registry.execute(
      {
        toolCallId: 'escape',
        toolName: 'ReadSkillResource',
        input: { skill_id: 'user-agents:review', relative_path: '../private.md' }
      },
      signal
    )
    expect(loaded.result).toMatchObject({
      isError: false,
      output: expect.stringContaining('Inspect before editing.')
    })
    expect(resource.result).toMatchObject({
      isError: false,
      output: expect.stringContaining('Reference text')
    })
    expect(generic.result.isError).toBe(true)
    expect(escape.result.isError).toBe(true)
  })
})
