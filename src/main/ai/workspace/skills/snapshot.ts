import { readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { SkillCatalog, SkillDocument, SkillSource } from '@shared/ai/skills'
import { parseSkillDocument } from './document'
import {
  assertContained,
  assertOutputSize,
  MAX_SKILL_DOCUMENT_BYTES,
  MAX_SKILL_RESOURCE_BYTES,
  readSkillFile,
  resolveResourcePath
} from './files'

interface SkillMetadata {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly source: SkillSource
  readonly baseDirectory: string
  readonly disableModelInvocation: boolean
  readonly userInvocable: boolean
}

interface SkillDiagnostic {
  readonly source: SkillSource
  readonly path: string
  readonly message: string
}

interface SkillSnapshot {
  readonly skills: readonly SkillMetadata[]
  readonly diagnostics: readonly SkillDiagnostic[]
  load(idOrName: string): Promise<string>
  loadForUser(id: string): Promise<string>
  readResource(idOrName: string, relativePath: string): Promise<string>
  readDocument(id: string): SkillDocument
}

interface DiscoveryDiagnostic extends SkillDiagnostic {
  readonly rejectedCanonicalDocument?: string
}

interface RegisteredSkill {
  readonly canonicalDocument: string
  readonly metadata: SkillMetadata
  readonly lexicalDirectory: string
  readonly body: string
  readonly document: string
}

interface SkillRoot {
  readonly source: SkillSource
  readonly path: string
  readonly owner: string
}

interface RootDiscovery {
  readonly skills: readonly RegisteredSkill[]
  readonly diagnostics: readonly DiscoveryDiagnostic[]
}

type EntryDiscovery =
  | {
      readonly kind: 'skill'
      readonly skill: RegisteredSkill
      readonly diagnostics: readonly DiscoveryDiagnostic[]
    }
  | { readonly kind: 'missing'; readonly canonicalDirectory?: string }
  | { readonly kind: 'rejected'; readonly diagnostics: readonly DiscoveryDiagnostic[] }

function skillScope(source: SkillSource): 'project' | 'user' {
  return source.startsWith('project-') ? 'project' : 'user'
}

function isMissing(error: Error): boolean {
  return 'code' in error && error.code === 'ENOENT'
}

function formatSkill(
  skill: RegisteredSkill,
  resource: string,
  body: string,
  maxBytes: number
): string {
  const { id, name, baseDirectory } = skill.metadata
  return assertOutputSize(
    `Skill: ${name}\nSkill ID: ${id}\nBase directory: ${baseDirectory}\nResource: ${resource}\n\n${body}`,
    maxBytes
  )
}

async function discoverEntry(
  root: SkillRoot,
  canonicalRoot: string,
  directory: string
): Promise<EntryDiscovery> {
  const lexicalDirectory = join(root.path, directory)
  const path = join(lexicalDirectory, 'SKILL.md')
  let canonicalDocument: string | undefined
  let canonicalDirectory: string | undefined
  let hasValidatedRootContainment = false
  try {
    // Identity is only used to reconcile rejected aliases after another root validates the skill.
    canonicalDirectory = await realpath(lexicalDirectory)
    canonicalDocument = await realpath(path)
    assertContained(canonicalRoot, canonicalDirectory)
    hasValidatedRootContainment = true
    assertContained(canonicalDirectory, canonicalDocument)
    const baseDirectory = canonicalDirectory
    const text = await readSkillFile(
      baseDirectory,
      path,
      MAX_SKILL_DOCUMENT_BYTES,
      canonicalDocument
    )
    const parsed = parseSkillDocument(text, basename(lexicalDirectory))
    const metadata = Object.freeze({
      id: `${root.source}:${parsed.name}`,
      name: parsed.name,
      description: parsed.description,
      source: root.source,
      baseDirectory,
      disableModelInvocation: parsed.disableModelInvocation,
      userInvocable: parsed.userInvocable
    })
    const skill = {
      canonicalDocument,
      metadata,
      lexicalDirectory,
      body: parsed.body,
      document: text
    }
    formatSkill(skill, 'SKILL.md', text, MAX_SKILL_DOCUMENT_BYTES)
    return {
      kind: 'skill',
      skill,
      diagnostics: parsed.warnings.map((message) => ({ source: root.source, path, message }))
    }
  } catch (error) {
    if (error instanceof Error && isMissing(error)) {
      return { kind: 'missing', canonicalDirectory }
    }
    return {
      kind: 'rejected',
      diagnostics: [
        {
          source: root.source,
          path,
          message: error instanceof Error ? error.message : 'Unknown filesystem error',
          rejectedCanonicalDocument: hasValidatedRootContainment ? undefined : canonicalDocument
        }
      ]
    }
  }
}

async function discoverRoot(root: SkillRoot): Promise<RootDiscovery> {
  try {
    const canonicalOwner = await realpath(root.owner)
    const canonicalRoot = await realpath(root.path)
    assertContained(canonicalOwner, canonicalRoot)
    const rootIdentity = await stat(canonicalRoot, { bigint: true })
    const ownerIdentity = await stat(canonicalOwner, { bigint: true })
    const entries = await readdir(root.path, { withFileTypes: true })
    const candidates = entries
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    const results = await Promise.all(
      candidates.map((entry) => discoverEntry(root, canonicalRoot, entry.name))
    )
    // Catalog layouts nest one extra level under directories without their own
    // SKILL.md. Every descent is gated by canonical containment, so external
    // aliases are skipped instead of being read or enumerated.
    const nestedProbes: Promise<EntryDiscovery[]>[] = []
    for (const [index, result] of results.entries()) {
      if (result.kind !== 'missing' || !result.canonicalDirectory) continue
      try {
        assertContained(canonicalRoot, result.canonicalDirectory)
      } catch {
        continue
      }
      const parent = candidates[index]!.name
      nestedProbes.push(
        readdir(result.canonicalDirectory, { withFileTypes: true })
          .then((childEntries) =>
            Promise.all(
              childEntries
                .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
                .sort((a, b) => a.name.localeCompare(b.name, 'en'))
                .map((child) => discoverEntry(root, canonicalRoot, join(parent, child.name)))
            )
          )
          .catch(() => [])
      )
    }
    const discoveries = [...results, ...(await Promise.all(nestedProbes)).flat()]
    const currentRoot = await stat(canonicalRoot, { bigint: true })
    const currentOwner = await stat(canonicalOwner, { bigint: true })
    if (
      (await realpath(root.path)) !== canonicalRoot ||
      (await realpath(root.owner)) !== canonicalOwner ||
      rootIdentity.dev !== currentRoot.dev ||
      rootIdentity.ino !== currentRoot.ino ||
      ownerIdentity.dev !== currentOwner.dev ||
      ownerIdentity.ino !== currentOwner.ino
    )
      throw new Error('Skill root changed while discovering. Retry in a new turn.')
    return {
      skills: discoveries.flatMap((result) => (result.kind === 'skill' ? [result.skill] : [])),
      diagnostics: discoveries.flatMap((result) =>
        result.kind === 'skill' || result.kind === 'rejected' ? result.diagnostics : []
      )
    }
  } catch (error) {
    return {
      skills: [],
      diagnostics:
        error instanceof Error && isMissing(error)
          ? []
          : [
              {
                source: root.source,
                path: root.path,
                message: error instanceof Error ? error.message : 'Unknown filesystem error'
              }
            ]
    }
  }
}

function resolveSkill(skills: readonly RegisteredSkill[], idOrName: string): RegisteredSkill {
  const skill = skills.find(
    ({ metadata }) => metadata.id === idOrName || metadata.name === idOrName
  )
  if (!skill)
    throw new Error(`Unknown skill "${idOrName}". Use a name or ID from this turn's catalog.`)
  return skill
}

async function readResource(skill: RegisteredSkill, relativePath: string): Promise<string> {
  try {
    const path = resolveResourcePath(skill.metadata.baseDirectory, relativePath)
    if (path === join(skill.metadata.baseDirectory, 'SKILL.md'))
      return formatSkill(skill, relativePath, skill.document, MAX_SKILL_DOCUMENT_BYTES)
    if ((await realpath(skill.lexicalDirectory)) !== skill.metadata.baseDirectory) {
      throw new Error(
        'Skill directory changed after this turn started. Start a new turn to rediscover it.'
      )
    }
    const prefix = formatSkill(skill, relativePath, '', MAX_SKILL_RESOURCE_BYTES)
    const budget = MAX_SKILL_RESOURCE_BYTES - Buffer.byteLength(prefix, 'utf8')
    const text = await readSkillFile(skill.metadata.baseDirectory, path, budget)
    return formatSkill(skill, relativePath, text, MAX_SKILL_RESOURCE_BYTES)
  } catch (error) {
    throw new Error(
      `Cannot read skill resource "${relativePath}" for "${skill.metadata.name}": ${error instanceof Error ? error.message : 'Unknown filesystem error'}`,
      { cause: error }
    )
  }
}

/** Captures catalog and skill documents once for a turn; resource text is read on demand. */
async function createSkillSnapshot(
  cwd: string,
  userHome: string = homedir()
): Promise<SkillSnapshot> {
  // Root order defines shadow precedence: project roots outrank user roots, and
  // within a tier the Agent Skills default leads, then compatibility catalogs.
  const roots: readonly SkillRoot[] = [
    {
      source: 'project-agents',
      path: join(resolve(cwd), '.agents', 'skills'),
      owner: resolve(cwd)
    },
    {
      source: 'project-claude',
      path: join(resolve(cwd), '.claude', 'skills'),
      owner: resolve(cwd)
    },
    {
      source: 'project-gemini',
      path: join(resolve(cwd), '.gemini', 'skills'),
      owner: resolve(cwd)
    },
    {
      source: 'project-cursor',
      path: join(resolve(cwd), '.cursor', 'skills'),
      owner: resolve(cwd)
    },
    {
      source: 'project-github',
      path: join(resolve(cwd), '.github', 'skills'),
      owner: resolve(cwd)
    },
    {
      source: 'project-skills',
      path: join(resolve(cwd), 'skills'),
      owner: resolve(cwd)
    },
    {
      source: 'user-agents',
      path: join(resolve(userHome), '.agents', 'skills'),
      owner: resolve(userHome)
    },
    {
      source: 'user-claude',
      path: join(resolve(userHome), '.claude', 'skills'),
      owner: resolve(userHome)
    },
    {
      source: 'user-config-agents',
      path: join(resolve(userHome), '.config', 'agents', 'skills'),
      owner: resolve(userHome)
    },
    {
      source: 'user-codex',
      path: join(resolve(userHome), '.codex', 'skills'),
      owner: resolve(userHome)
    },
    {
      source: 'user-cursor',
      path: join(resolve(userHome), '.cursor', 'skills'),
      owner: resolve(userHome)
    },
    {
      source: 'user-gemini',
      path: join(resolve(userHome), '.gemini', 'skills'),
      owner: resolve(userHome)
    }
  ]
  const discoveries = await Promise.all(roots.map(discoverRoot))
  const discoveredSkills = discoveries.flatMap(({ skills }) => skills)
  const allSkills = discoveredSkills.filter(
    (skill, index) =>
      discoveredSkills.findIndex(
        ({ canonicalDocument }) => canonicalDocument === skill.canonicalDocument
      ) === index
  )
  const validatedDocuments = new Set(allSkills.map(({ canonicalDocument }) => canonicalDocument))
  const diagnostics = discoveries
    .flatMap(({ diagnostics }) => diagnostics)
    .filter(
      ({ rejectedCanonicalDocument }) =>
        !rejectedCanonicalDocument || !validatedDocuments.has(rejectedCanonicalDocument)
    )
  const registered = allSkills.filter(
    (skill, index) =>
      allSkills.findIndex(({ metadata }) => metadata.name === skill.metadata.name) === index
  )
  const shadowed = allSkills
    .filter((skill) => {
      if (registered.includes(skill)) return false
      const winner = resolveSkill(registered, skill.metadata.name)
      // Compatibility copies stay quiet only within the same scope tier and
      // only while the documents remain byte-identical; cross-tier overrides
      // and divergent documents keep their shadowing notice.
      return (
        skillScope(winner.metadata.source) !== skillScope(skill.metadata.source) ||
        winner.document !== skill.document
      )
    })
    .map(({ metadata, lexicalDirectory }) => ({
      source: metadata.source,
      path: join(lexicalDirectory, 'SKILL.md'),
      message: `Skill "${metadata.name}" is shadowed by a higher-priority skill with the same name.`
    }))
  return Object.freeze({
    skills: Object.freeze(registered.map(({ metadata }) => metadata)),
    diagnostics: Object.freeze(
      [...diagnostics, ...shadowed].map(({ source, path, message }) =>
        Object.freeze({ source, path, message })
      )
    ),
    async load(idOrName: string): Promise<string> {
      const skill = resolveSkill(registered, idOrName)
      return formatSkill(skill, 'SKILL.md', skill.body, MAX_SKILL_DOCUMENT_BYTES)
    },
    async loadForUser(id: string): Promise<string> {
      const skill = registered.find(({ metadata }) => metadata.id === id)
      if (!skill)
        throw new Error(`Unknown skill "${id}". Refresh the skill catalog and select it again.`)
      if (!skill.metadata.userInvocable) {
        throw new Error(
          `Skill "${skill.metadata.name}" cannot be invoked by users. Select another skill.`
        )
      }
      return formatSkill(skill, 'SKILL.md', skill.body, MAX_SKILL_DOCUMENT_BYTES)
    },
    async readResource(idOrName: string, relativePath: string): Promise<string> {
      return readResource(resolveSkill(registered, idOrName), relativePath)
    },
    readDocument(id: string): SkillDocument {
      const skill = registered.find(({ metadata }) => metadata.id === id)
      if (!skill) throw new Error('Unknown skill. Refresh the catalog and select it again.')
      return { content: skill.document, body: skill.body }
    }
  })
}

export type { SkillDiagnostic, SkillMetadata, SkillSnapshot, SkillSource }

/** Renderer catalog deliberately omits native base directories and hidden skills. */
function skillCatalog(snapshot: SkillSnapshot): SkillCatalog {
  const catalog = skillSettingsCatalog(snapshot)
  return { ...catalog, skills: catalog.skills.filter(({ userInvocable }) => userInvocable) }
}

/** Browsing includes model-only skills without exposing filesystem access. */
function skillSettingsCatalog(snapshot: SkillSnapshot): SkillCatalog {
  return {
    skills: snapshot.skills.map(
      ({ id, name, description, source, userInvocable, disableModelInvocation }) => ({
        id,
        name,
        description,
        source,
        userInvocable,
        disableModelInvocation
      })
    ),
    diagnostics: snapshot.diagnostics.map(({ path, source, message }) => ({
      path,
      source,
      message: `Skill discovery notice for this entry: ${message} Review the reported issue, then refresh the catalog.`
    }))
  }
}

export { createSkillSnapshot, skillCatalog, skillSettingsCatalog }
