import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { loadProjectInstructions } from './project-guidance'

describe('loadProjectInstructions', () => {
  it('user starts work when the workspace was deleted, then receives recovery guidance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mico-guidance-'))
    await rm(root, { recursive: true, force: true })

    const context = await loadProjectInstructions(root)

    expect(context).toContain(root)
    expect(context).toContain('Project instruction diagnostic')
    expect(context).toContain('Select an available workspace or restore the directory')
  })

  it('user starts work when root guidance exists, then only the highest priority file applies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mico-guidance-'))
    try {
      await writeFile(join(root, 'CLAUDE.md'), 'Claude guidance')
      await writeFile(join(root, 'AGENTS.md'), 'Agent guidance')
      await writeFile(join(root, 'AGENTS.override.md'), 'Override guidance')
      const context = await loadProjectInstructions(root)
      expect(context).toContain('Override guidance')
      expect(context).toContain(join(root, 'AGENTS.override.md'))
      expect(context).not.toContain('Agent guidance')
      expect(context).not.toContain('Claude guidance')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('user starts work when guidance escapes the root, then receives a diagnostic without leaked content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mico-guidance-'))
    const outside = await mkdtemp(join(tmpdir(), 'mico-outside-'))
    try {
      await writeFile(join(outside, 'private.md'), 'Private content')
      await symlink(join(outside, 'private.md'), join(root, 'AGENTS.md'))
      const context = await loadProjectInstructions(root)
      expect(context).toContain('outside the project root')
      expect(context).not.toContain('Private content')
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it.each([Buffer.alloc(64 * 1024 + 1, 'a'), Buffer.from([0xff])])(
    'user starts work when guidance is unreadable, then receives an actionable diagnostic',
    async (bytes) => {
      const root = await mkdtemp(join(tmpdir(), 'mico-guidance-'))
      try {
        await writeFile(join(root, 'CLAUDE.md'), bytes)
        expect(await loadProjectInstructions(root)).toContain('Fix the file and start a new turn')
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  )
})
