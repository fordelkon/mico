import { execFile } from 'node:child_process'
import filesystem, {
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
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSkillSnapshot, skillCatalog } from './index'

const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
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

  it('user has cross-root skill aliases when discovering, then only canonical notices remain', async () => {
    const { cwd, home } = await workspace()
    const canonicalRoot = join(home, '.agents/skills')
    const compatibilityRoot = join(home, '.claude/skills')
    const review = await skill(canonicalRoot, 'review', `${validMetadata}\ncontext: fork`)
    const malformed = await skill(
      canonicalRoot,
      'malformed',
      'name: malformed\ndescription: [broken'
    )
    await mkdir(compatibilityRoot, { recursive: true })
    await symlink(review, join(compatibilityRoot, 'review'))
    await symlink(malformed, join(compatibilityRoot, 'malformed'))

    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills.map(({ id }) => id)).toEqual(['user-agents:review'])
    expect(await snapshot.load('review')).toContain('Original instructions')
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: join(review, 'SKILL.md'),
          message: expect.stringContaining('context')
        }),
        expect.objectContaining({
          path: join(malformed, 'SKILL.md'),
          message: expect.stringContaining('Invalid skill YAML')
        }),
        expect.objectContaining({
          path: join(compatibilityRoot, 'malformed', 'SKILL.md'),
          message: expect.stringContaining('inside the skill directory')
        })
      ])
    )
    expect(snapshot.diagnostics).toHaveLength(3)
  })

  it('user keeps identical copies in compatibility roots when discovering, then no shadow notice appears', async () => {
    const { cwd, home } = await workspace()
    await skill(join(home, '.agents/skills'), 'review', validMetadata, 'Shared instructions')
    await skill(join(home, '.claude/skills'), 'review', validMetadata, 'Shared instructions')

    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills.map(({ id }) => id)).toEqual(['user-agents:review'])
    expect(snapshot.diagnostics).toEqual([])
    expect(await snapshot.load('review')).toContain('Shared instructions')
  })

  it('user keeps distinct copies when discovering, then the shadow notice remains', async () => {
    const { cwd, home } = await workspace()
    await skill(join(home, '.agents/skills'), 'review', validMetadata, 'Canonical instructions')
    await skill(join(home, '.claude/skills'), 'review', validMetadata, 'Compatibility instructions')

    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills.map(({ id }) => id)).toEqual(['user-agents:review'])
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({
        path: join(home, '.claude/skills/review/SKILL.md'),
        message: expect.stringContaining('shadowed')
      })
    ])
  })

  it('user changes a document when discovering, then replacement and alias stay rejected', async () => {
    const { cwd, home } = await workspace()
    const base = await skill(join(home, '.agents/skills'), 'review', validMetadata)
    const document = join(base, 'SKILL.md')
    const original = join(base, 'original.md')
    const replacement = join(base, 'replacement.md')
    await rename(document, original)
    await writeFile(replacement, `---\n${validMetadata}\n---\nReplacement instructions`)
    await symlink(original, document)
    const outside = join(home, 'outside')
    const alias = join(home, '.claude/skills/review')
    await mkdir(outside)
    await mkdir(join(home, '.claude/skills'), { recursive: true })
    await symlink(original, join(outside, 'SKILL.md'))
    await symlink(outside, alias)
    const originalRealpath = filesystem.realpath
    let replaced = false
    // Keep real path resolution; change the document after its first identity capture.
    vi.spyOn(filesystem, 'realpath').mockImplementation(async (...args) => {
      const canonical = await originalRealpath(...args)
      if (!replaced && args[0] === document) {
        replaced = true
        await rm(document)
        await symlink(replacement, document)
      }
      return canonical
    })
    syncBuiltinESMExports()

    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills).toEqual([])
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: document, message: expect.stringContaining('changed') }),
        expect.objectContaining({
          path: join(alias, 'SKILL.md'),
          message: expect.stringContaining('inside the skill directory')
        })
      ])
    )
  })

  it('user has contained aliases when discovering, then the same skill appears once without notices', async () => {
    const { cwd, home } = await workspace()
    const root = join(cwd, '.agents/skills')
    const base = await skill(root, 'review', validMetadata)
    await symlink(base, join(root, 'review-alias'))

    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills.map(({ id }) => id)).toEqual(['project-agents:review'])
    expect(snapshot.diagnostics).toEqual([])
    expect(await snapshot.load('review')).toContain('Original instructions')
  })

  it('user has missing skill entries when discovering, then absent documents are skipped', async () => {
    const { cwd, home } = await workspace()
    const root = join(cwd, '.agents/skills')
    await skill(root, 'review', validMetadata)
    await mkdir(join(root, 'ordinary-directory'))
    await mkdir(join(root, 'missing-document'))
    await symlink(join(home, 'absent-directory'), join(root, 'dangling-directory'))
    await symlink(join(home, 'absent-document'), join(root, 'missing-document', 'SKILL.md'))

    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills.map(({ id }) => id)).toEqual(['project-agents:review'])
    expect(snapshot.diagnostics).toEqual([])
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
    await skill(root, 'large', 'name: large\ndescription: Large', '😀'.repeat(66000))
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

  it('user lists skills when invocation flags differ, then user and model permissions stay independent', async () => {
    const { cwd, home } = await workspace()
    const root = join(cwd, '.agents/skills')
    await skill(root, 'review', validMetadata)
    await skill(root, 'hidden', 'name: hidden\ndescription: Model only\nuser-invocable: false')
    await skill(root, 'invalid', 'name: invalid\ndescription: Invalid\nuser-invocable: "false"')
    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills.find(({ name }) => name === 'review')).toMatchObject({
      userInvocable: true
    })
    expect(snapshot.skills.find(({ name }) => name === 'hidden')).toMatchObject({
      userInvocable: false,
      disableModelInvocation: false
    })
    await expect(snapshot.loadForUser('project-agents:hidden')).rejects.toThrow(
      'cannot be invoked by users'
    )
    await expect(snapshot.loadForUser('review')).rejects.toThrow('Unknown skill')
    expect(await snapshot.loadForUser('project-agents:review')).toContain('Original instructions')
    expect(snapshot.diagnostics).toHaveLength(1)
    const catalog = skillCatalog(snapshot)
    expect(catalog.skills.map(({ name }) => name)).toEqual(['review'])
    expect(catalog.skills[0]).not.toHaveProperty('baseDirectory')
    expect(catalog.diagnostics[0]?.message).toContain('refresh the catalog')
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

  it('user loads a large skill when discovering, then its instructions stay intact', async () => {
    const { cwd, home } = await workspace()
    const body = 'x'.repeat(88 * 1024)
    const base = await skill(join(cwd, '.agents/skills'), 'review', validMetadata, body)
    await mkdir(join(cwd, '.claude/skills'), { recursive: true })
    await symlink(base, join(cwd, '.claude/skills/review'))
    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.diagnostics).toEqual([])
    expect(snapshot.readDocument('project-agents:review').body).toBe(body)
    expect(await snapshot.loadForUser('project-agents:review')).toContain(body)
    expect(await snapshot.load('project-agents:review')).toContain(body)
    expect(await snapshot.readResource('project-agents:review', 'SKILL.md')).toContain(body)
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
      let replaced = false
      if (replacement === 'file') {
        const probe = await open(resource, 'r')
        const prototype: FileHandle = Object.getPrototypeOf(probe)
        // The saved method is explicitly rebound with apply to the real handle below.
        // oxlint-disable-next-line typescript/unbound-method
        const originalRead = prototype.read
        const resourceIdentity = await probe.stat()
        await probe.close()
        // Keep real I/O; replace the file during reading to exercise the final path check.
        vi.spyOn(prototype, 'read').mockImplementation(async function (this: FileHandle, ...args) {
          const identity = await this.stat()
          if (
            !replaced &&
            identity.ino === resourceIdentity.ino &&
            identity.dev === resourceIdentity.dev
          ) {
            replaced = true
            await rename(resource, `${resource}-old`)
            await writeFile(resource, 'Replacement reference')
          }
          return originalRead.apply(this, args)
        })
      } else {
        const canonicalResource = await realpath(resource)
        const originalOpen = filesystem.open
        // Windows cannot rename ancestors of an open file. Schedule the real replacement
        // after path identities are captured but before the resource handle is opened.
        vi.spyOn(filesystem, 'open').mockImplementation(async (path, flags, mode) => {
          if (!replaced && path === canonicalResource) {
            replaced = true
            const target = replacement === 'root' ? base : directory
            await rename(target, `${target}-old`)
            await symlink(replacement === 'root' ? outside : join(outside, 'references'), target)
          }
          return originalOpen(path, flags, mode)
        })
        syncBuiltinESMExports()
      }

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

  it('user has compatibility roots when discovering, then gemini, cursor, github, and skills catalogs register', async () => {
    const { cwd, home } = await workspace()
    await skill(
      join(cwd, '.gemini/skills'),
      'gemini-skill',
      'name: gemini-skill\ndescription: Gemini'
    )
    await skill(
      join(cwd, '.cursor/skills'),
      'cursor-skill',
      'name: cursor-skill\ndescription: Cursor'
    )
    await skill(
      join(cwd, '.github/skills'),
      'github-skill',
      'name: github-skill\ndescription: GitHub'
    )
    await skill(join(cwd, 'skills'), 'plain-skill', 'name: plain-skill\ndescription: Plain')

    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills.map(({ id }) => id)).toEqual([
      'project-gemini:gemini-skill',
      'project-cursor:cursor-skill',
      'project-github:github-skill',
      'project-skills:plain-skill'
    ])
    expect(snapshot.diagnostics).toEqual([])
  })

  it('user has user compatibility roots when discovering, then config, codex, cursor, and gemini catalogs register', async () => {
    const { cwd, home } = await workspace()
    await skill(
      join(home, '.config/agents/skills'),
      'config-skill',
      'name: config-skill\ndescription: Config agents'
    )
    await skill(join(home, '.codex/skills'), 'codex-skill', 'name: codex-skill\ndescription: Codex')
    await skill(
      join(home, '.cursor/skills'),
      'cursor-skill',
      'name: cursor-skill\ndescription: Cursor'
    )
    await skill(
      join(home, '.gemini/skills'),
      'gemini-skill',
      'name: gemini-skill\ndescription: Gemini'
    )

    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills.map(({ id }) => id)).toEqual([
      'user-config-agents:config-skill',
      'user-codex:codex-skill',
      'user-cursor:cursor-skill',
      'user-gemini:gemini-skill'
    ])
    expect(snapshot.diagnostics).toEqual([])
  })

  it('user nests skills under catalog directories when discovering, then depth-two documents register', async () => {
    const { cwd, home } = await workspace()
    await skill(
      join(home, '.codex/skills/.system'),
      'imagegen',
      'name: imagegen\ndescription: Codex system',
      'Codex system instructions'
    )
    await skill(
      join(cwd, 'skills/.curated'),
      'curated-skill',
      'name: curated-skill\ndescription: Curated'
    )

    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills.map(({ id }) => id)).toEqual([
      'project-skills:curated-skill',
      'user-codex:imagegen'
    ])
    expect(await snapshot.load('imagegen')).toContain('Codex system')
    expect(snapshot.diagnostics).toEqual([])
  })

  it('user nests a document under a skill directory when discovering, then the catalog stays at one level', async () => {
    const { cwd, home } = await workspace()
    const root = join(cwd, '.agents/skills')
    await skill(root, 'review', validMetadata)
    await skill(
      join(root, 'review/nested'),
      'nested-skill',
      'name: nested-skill\ndescription: Nested'
    )

    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills.map(({ id }) => id)).toEqual(['project-agents:review'])
    expect(snapshot.diagnostics).toEqual([])
  })

  it('user aliases a catalog directory when discovering, then depth-two skills appear once', async () => {
    const { cwd, home } = await workspace()
    const root = join(cwd, '.agents/skills')
    const base = await skill(join(root, 'catalog'), 'review', validMetadata)
    await symlink(join(root, 'catalog'), join(root, 'alias'))

    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills.map(({ id }) => id)).toEqual(['project-agents:review'])
    expect(snapshot.skills[0]?.baseDirectory).toBe(await realpath(base))
    expect(snapshot.diagnostics).toEqual([])
  })

  it('user links an external catalog directory when discovering, then nested skills stay excluded', async () => {
    const { cwd, home } = await workspace()
    await skill(join(home), 'catalog', 'name: outside\ndescription: Outside')
    await skill(join(home, 'catalog/nested'), 'secret', 'name: secret\ndescription: Secret')
    await mkdir(join(cwd, 'skills'), { recursive: true })
    await symlink(join(home, 'catalog'), join(cwd, 'skills', 'linked'))

    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills).toEqual([])
    expect(snapshot.diagnostics[0]?.message).toContain('inside the skill directory')
  })

  it('user links an external directory without a document when discovering, then descent stays inside the root', async () => {
    const { cwd, home } = await workspace()
    await skill(join(home, 'outside-catalog/nested'), 'secret', 'name: secret\ndescription: Secret')
    const root = join(cwd, '.agents/skills')
    await mkdir(root, { recursive: true })
    await symlink(join(home, 'outside-catalog'), join(root, 'linked'))

    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills).toEqual([])
    expect(snapshot.diagnostics).toEqual([])
  })

  it('user omits frontmatter when discovering, then metadata is derived with a diagnostic', async () => {
    const { cwd, home } = await workspace()
    const root = join(cwd, '.agents/skills')
    await mkdir(join(root, 'review.v2'), { recursive: true })
    await writeFile(
      join(root, 'review.v2/SKILL.md'),
      '# Review v2\n\nInstructions without frontmatter.'
    )

    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills[0]).toMatchObject({
      id: 'project-agents:review.v2',
      name: 'review.v2',
      description: '# Review v2',
      userInvocable: true,
      disableModelInvocation: false
    })
    expect(snapshot.diagnostics).toHaveLength(1)
    expect(snapshot.diagnostics[0]?.message).toContain('frontmatter')
    expect(await snapshot.load('review.v2')).toContain('Instructions without frontmatter.')
  })

  it('user leaves the frontmatter delimiter unclosed when authoring, then the document is rejected instead of derived', async () => {
    const { cwd, home } = await workspace()
    const root = join(cwd, '.agents/skills')
    await skill(root, 'good', 'name: good\ndescription: Valid skill')
    await mkdir(join(root, 'deploy'), { recursive: true })
    await writeFile(
      join(root, 'deploy/SKILL.md'),
      '---\nname: deploy\ndescription: Deploy the app\n\nDeployment steps without a closing delimiter.'
    )

    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills.map(({ id }) => id)).toEqual(['project-agents:good'])
    expect(snapshot.diagnostics[0]?.message).toContain('closing --- delimiter')
  })

  it('user names a directory outside the name pattern when discovering, then the derived document is rejected', async () => {
    const { cwd, home } = await workspace()
    const root = join(cwd, '.agents/skills')
    await skill(root, 'good', 'name: good\ndescription: Valid skill')
    await mkdir(join(root, 'Review'), { recursive: true })
    await writeFile(join(root, 'Review/SKILL.md'), 'Instructions without frontmatter.')

    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills.map(({ id }) => id)).toEqual(['project-agents:good'])
    expect(snapshot.diagnostics[0]?.message).toContain('Invalid skill metadata')
  })

  it('user names skills with dots, underscores, and leading digits when discovering, then relaxed names register', async () => {
    const { cwd, home } = await workspace()
    const root = join(cwd, '.agents/skills')
    await skill(root, 'review.v2', 'name: review.v2\ndescription: Dotted')
    await skill(root, 'my_skill', 'name: my_skill\ndescription: Underscored')
    await skill(root, '2fast', 'name: 2fast\ndescription: Leading digit')
    await skill(root, 'bad', 'name: Review\ndescription: Uppercase')

    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills.map(({ id }) => id)).toEqual([
      'project-agents:2fast',
      'project-agents:my_skill',
      'project-agents:review.v2'
    ])
    expect(snapshot.diagnostics).toHaveLength(1)
  })

  it('user keeps byte-identical copies across compatibility roots when discovering, then no shadow notice appears', async () => {
    const { cwd, home } = await workspace()
    await skill(join(home, '.agents/skills'), 'review', validMetadata, 'Shared instructions')
    await skill(join(home, '.cursor/skills'), 'review', validMetadata, 'Shared instructions')
    await skill(join(home, '.gemini/skills'), 'review', validMetadata, 'Shared instructions')

    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills.map(({ id }) => id)).toEqual(['user-agents:review'])
    expect(snapshot.diagnostics).toEqual([])
  })

  it('user keeps divergent copies across compatibility roots when discovering, then each shadow notice remains', async () => {
    const { cwd, home } = await workspace()
    await skill(join(home, '.agents/skills'), 'review', validMetadata, 'Canonical instructions')
    await skill(join(home, '.cursor/skills'), 'review', validMetadata, 'Cursor instructions')
    await skill(join(home, '.gemini/skills'), 'review', validMetadata, 'Gemini instructions')

    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills.map(({ id }) => id)).toEqual(['user-agents:review'])
    expect(snapshot.diagnostics.map(({ path }) => path)).toEqual([
      join(home, '.cursor/skills/review/SKILL.md'),
      join(home, '.gemini/skills/review/SKILL.md')
    ])
  })

  it('user overrides a compatibility root from the workspace when discovering, then the shadow notice remains', async () => {
    const { cwd, home } = await workspace()
    await skill(join(home, '.cursor/skills'), 'review', validMetadata, 'User instructions')
    await skill(join(cwd, '.gemini/skills'), 'review', validMetadata, 'Project instructions')

    const snapshot = await createSkillSnapshot(cwd, home)

    expect(snapshot.skills.map(({ id }) => id)).toEqual(['project-gemini:review'])
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({
        path: join(home, '.cursor/skills/review/SKILL.md'),
        message: expect.stringContaining('shadowed')
      })
    ])
  })
})
