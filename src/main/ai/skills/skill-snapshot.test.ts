import { execFile } from 'node:child_process'
import {
  type FileHandle,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSkillSnapshot } from './index'

const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

async function workspace(): Promise<{ cwd: string; home: string }> {
  const root = await mkdtemp(join(tmpdir(), 'mico-skills-'))
  temporaryDirectories.push(root)
  const cwd = join(root, 'project')
  const home = join(root, 'home')
  await Promise.all([mkdir(cwd), mkdir(home)])
  return { cwd, home }
}

async function skill(
  root: string,
  directory: string,
  frontmatter: string,
  body = 'Original instructions'
): Promise<string> {
  const base = join(root, directory)
  await mkdir(base, { recursive: true })
  await writeFile(join(base, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}`)
  return base
}

const validMetadata = 'name: review\ndescription: Review code'

describe('skill snapshots', () => {
  it('user has overlapping skills when discovering, then project canonical skills win', async () => {
    const { cwd, home } = await workspace()
    await skill(join(home, '.agents/skills'), 'review', validMetadata, 'User canonical')
    await skill(join(cwd, '.claude/skills'), 'review', validMetadata, 'Project fallback')
    const base = await skill(
      join(cwd, '.agents/skills'),
      'different-folder',
      validMetadata,
      'Project canonical'
    )
    await skill(
      join(home, '.claude/skills'),
      'fallback',
      'name: fallback\ndescription: Compatibility skill'
    )
    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills.map(({ id }) => id)).toEqual([
      'project-agents:review',
      'user-claude:fallback'
    ])
    expect(snapshot.skills[0]).toMatchObject({
      baseDirectory: await realpath(base),
      description: 'Review code'
    })
    expect(snapshot.diagnostics.filter(({ message }) => message.includes('shadowed'))).toHaveLength(
      2
    )
    expect(await snapshot.load('project-agents:review')).toContain('Project canonical')
  })

  it('user edits a skill when a turn exists, then that turn retains its original body', async () => {
    const { cwd, home } = await workspace()
    const base = await skill(join(cwd, '.agents/skills'), 'review', validMetadata)
    const snapshot = await createSkillSnapshot(cwd, home)
    await writeFile(join(base, 'SKILL.md'), `---\n${validMetadata}\n---\nUpdated instructions`)

    expect(await snapshot.load('project-agents:review')).toContain('Original instructions')
    expect(await snapshot.load('project-agents:review')).toContain(await realpath(base))
    expect(await (await createSkillSnapshot(cwd, home)).load('project-agents:review')).toContain(
      'Updated instructions'
    )
    await expect(snapshot.load(base)).rejects.toThrow('Unknown skill')
  })

  it('user has invalid or oversized skills when discovering, then usable skills remain with diagnostics', async () => {
    const { cwd, home } = await workspace()
    const root = join(cwd, '.agents/skills')
    await skill(
      root,
      'good',
      'name: good\ndescription: >-\n  Multiline YAML\n  description\ncontext: fork'
    )
    await skill(root, 'bad-yaml', 'name: bad-yaml\ndescription: [unterminated')
    await skill(
      root,
      'bad-flag',
      'name: bad-flag\ndescription: Bad flag\ndisable-model-invocation: "false"'
    )
    await skill(root, 'large', 'name: large\ndescription: Large', '😀'.repeat(16000))
    await skill(
      root,
      'alias',
      'name: alias\ndescription: &description Description\nother: *description'
    )
    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills.map(({ name }) => name)).toEqual(['good'])
    expect(snapshot.skills[0]?.description).toBe('Multiline YAML description')
    expect(snapshot.diagnostics).toHaveLength(5)
    expect(snapshot.diagnostics.map(({ message }) => message).join('\n')).toContain('context')
  })

  it('user names a manual skill when loading, then its hidden instructions remain available', async () => {
    const { cwd, home } = await workspace()
    await skill(
      join(cwd, '.agents/skills'),
      'manual',
      'name: manual\ndescription: User only\ndisable-model-invocation: true'
    )
    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills[0]?.disableModelInvocation).toBe(true)
    expect(await snapshot.load('manual')).toContain('Original instructions')
    expect(await snapshot.readResource('project-agents:manual', 'SKILL.md')).toContain(
      'Original instructions'
    )
  })

  it('user reads resources when registered, then contained text is returned without execution', async () => {
    const { cwd, home } = await workspace()
    const base = await skill(join(cwd, '.agents/skills'), 'review', validMetadata)
    await mkdir(join(base, 'scripts'))
    await writeFile(join(base, 'scripts/example.sh'), 'touch should-never-exist')
    const snapshot = await createSkillSnapshot(cwd, home)

    expect(await snapshot.readResource('project-agents:review', 'scripts/example.sh')).toContain(
      'touch should-never-exist'
    )
    expect(await snapshot.readResource('project-agents:review', 'SKILL.md')).toContain(
      'Original instructions'
    )
    await expect(snapshot.readResource('project-agents:review', 'scripts')).rejects.toThrow(
      'regular file'
    )
    await expect(snapshot.readResource('project-agents:review', 'missing')).rejects.toThrow(
      'Cannot read skill resource'
    )
  })

  it('user reads a special file when it has no writer, then it is rejected promptly', async () => {
    const { cwd, home } = await workspace()
    const base = await skill(join(cwd, '.agents/skills'), 'review', validMetadata)
    const specialPath = join(base, 'special')
    if (process.platform === 'win32') {
      await mkdir(specialPath)
    } else {
      await promisify(execFile)('mkfifo', [specialPath])
    }
    const snapshot = await createSkillSnapshot(cwd, home)

    await expect(snapshot.readResource('review', 'special')).rejects.toThrow('regular file')
  })

  it('user reads an escaping resource when paths traverse or follow symlinks, then access is denied', async () => {
    const { cwd, home } = await workspace()
    const base = await skill(join(cwd, '.agents/skills'), 'review', validMetadata)
    await writeFile(join(cwd, 'secret'), 'Private')
    await symlink(join(cwd, 'secret'), join(base, 'escape'))
    const snapshot = await createSkillSnapshot(cwd, home)

    for (const path of [
      '../review/SKILL.md',
      join(base, 'SKILL.md'),
      'escape',
      'C:\\secret',
      '..\\secret'
    ]) {
      await expect(snapshot.readResource('project-agents:review', path)).rejects.toThrow(
        'inside the skill directory'
      )
    }
  })

  it('user reads oversized or binary resources when registered, then output is rejected intact', async () => {
    const { cwd, home } = await workspace()
    const base = await skill(join(cwd, '.agents/skills'), 'review', validMetadata)
    await writeFile(join(base, 'large.txt'), 'x'.repeat(48 * 1024))
    await writeFile(join(base, 'binary'), Buffer.from([0xff, 0xfe]))
    const snapshot = await createSkillSnapshot(cwd, home)

    await expect(snapshot.readResource('project-agents:review', 'large.txt')).rejects.toThrow(
      '48 KiB'
    )
    await expect(snapshot.readResource('project-agents:review', 'binary')).rejects.toThrow('UTF-8')
  })

  it('user replaces a skill directory when reading a reference, then the new root is rejected', async () => {
    const { cwd, home } = await workspace()
    const base = await skill(join(cwd, '.agents/skills'), 'review', validMetadata)
    await writeFile(join(base, 'reference.md'), 'Original reference')
    const snapshot = await createSkillSnapshot(cwd, home)
    await rename(base, `${base}-old`)
    const outside = await skill(home, 'outside', validMetadata)
    await writeFile(join(outside, 'reference.md'), 'Private reference')
    await symlink(outside, base)

    await expect(snapshot.readResource('review', 'reference.md')).rejects.toThrow(
      'Skill directory changed'
    )
    expect(await snapshot.load('review')).toContain('Original instructions')
  })

  it.each([
    ['project', '.agents', 'skills'],
    ['project', '.claude', 'skills'],
    ['home', '.agents', 'skills'],
    ['home', '.claude', 'skills'],
    ['project', '.agents', 'parent'],
    ['home', '.agents', 'parent']
  ])(
    'user links %s %s %s outside when discovering, then skills are excluded',
    async (owner, config, link) => {
      const { cwd, home } = await workspace()
      const owned = owner === 'project' ? cwd : home
      const outside = join(owner === 'project' ? home : cwd, 'outside')
      await skill(join(outside, 'skills'), 'review', validMetadata)
      if (link === 'parent') {
        await symlink(outside, join(owned, config))
      } else {
        await mkdir(join(owned, config))
        await symlink(join(outside, 'skills'), join(owned, config, 'skills'))
      }

      const snapshot = await createSkillSnapshot(cwd, home)

      expect(snapshot.skills).toEqual([])
      expect(snapshot.diagnostics.map(({ message }) => message).join('\n')).toContain(
        'inside the skill directory'
      )
    }
  )

  it('user opens linked owners when discovering, then contained linked skills stay usable', async () => {
    const { cwd, home } = await workspace()
    const base = await skill(join(cwd, '.agents/skills'), 'review', validMetadata)
    await writeFile(join(base, 'reference.md'), 'Contained reference')
    await symlink(join(base, 'reference.md'), join(base, 'linked.md'))
    const linkedCwd = `${cwd}-link`
    const linkedHome = `${home}-link`
    await Promise.all([symlink(cwd, linkedCwd), symlink(home, linkedHome)])

    const snapshot = await createSkillSnapshot(linkedCwd, linkedHome)

    expect(snapshot.skills).toHaveLength(1)
    expect(await snapshot.readResource('review', 'linked.md')).toContain('Contained reference')
  })

  it.each(['file', 'ancestor', 'root'])(
    'user reads during %s replacement when paths change, then resource access fails',
    async (replacement) => {
      const { cwd, home } = await workspace()
      const base = await skill(join(cwd, '.agents/skills'), 'review', validMetadata)
      const directory = join(base, 'references')
      await mkdir(directory)
      const resource = join(directory, 'reference.md')
      await writeFile(resource, 'Original reference')
      const outside = join(home, 'outside')
      await mkdir(join(outside, 'references'), { recursive: true })
      await writeFile(join(outside, 'references/reference.md'), 'Private reference')
      const snapshot = await createSkillSnapshot(cwd, home)
      const probe = await open(resource, 'r')
      const prototype: FileHandle = Object.getPrototypeOf(probe)
      // The saved method is explicitly rebound with apply to the real handle below.
      // oxlint-disable-next-line typescript/unbound-method
      const originalRead = prototype.read
      const resourceIdentity = await probe.stat()
      await probe.close()
      let replaced = false
      // Keep real I/O; intercept its public handle seam only to schedule the filesystem race.
      vi.spyOn(prototype, 'read').mockImplementation(async function (this: FileHandle, ...args) {
        const identity = await this.stat()
        if (
          !replaced &&
          identity.ino === resourceIdentity.ino &&
          identity.dev === resourceIdentity.dev
        ) {
          replaced = true
          const target =
            replacement === 'file' ? resource : replacement === 'root' ? base : directory
          await rename(target, `${target}-old`)
          if (replacement === 'file') await writeFile(target, 'Replacement reference')
          else await symlink(replacement === 'root' ? outside : join(outside, 'references'), target)
        }
        return originalRead.apply(this, args)
      })

      await expect(snapshot.readResource('review', 'references/reference.md')).rejects.toThrow(
        'changed'
      )
    }
  )

  it('user links an external skill when discovering, then it is diagnosed and excluded', async () => {
    const { cwd, home } = await workspace()
    const outside = await skill(home, 'outside', validMetadata)
    await mkdir(join(cwd, '.agents/skills'), { recursive: true })
    await symlink(outside, join(cwd, '.agents/skills/review'))
    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills).toEqual([])
    expect(snapshot.diagnostics[0]?.message).toContain('inside the skill directory')
  })
})
