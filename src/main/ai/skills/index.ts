import { readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { SkillCatalog, SkillDocument, SkillSource } from '@shared/ai/skills'
import { parseSkillDocument } from './skill-document'
import {
  assertContained,
  assertOutputSize,
  MAX_SKILL_OUTPUT_BYTES,
  readSkillFile,
  resolveResourcePath
} from './skill-files'

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

function isMissing(error: Error): boolean {
  return 'code' in error && error.code === 'ENOENT'
}

function formatSkill(skill: RegisteredSkill, resource: string, body: string): string {
  const { id, name, baseDirectory } = skill.metadata
  return assertOutputSize(
    `Skill: ${name}\nSkill ID: ${id}\nBase directory: ${baseDirectory}\nResource: ${resource}\n\n${body}`
  )
}

async function discoverEntry(
  root: SkillRoot,
  canonicalRoot: string,
  directory: string
): Promise<RootDiscovery> {
  const lexicalDirectory = join(root.path, directory)
  const path = join(lexicalDirectory, 'SKILL.md')
  let canonicalDocument: string | undefined
  let hasValidatedRootContainment = false
  try {
    const baseDirectory = await realpath(lexicalDirectory)
    // Identity is only used to reconcile rejected aliases after another root validates the skill.
    canonicalDocument = await realpath(path)
    assertContained(canonicalRoot, baseDirectory)
    hasValidatedRootContainment = true
    assertContained(baseDirectory, canonicalDocument)
    const text = await readSkillFile(baseDirectory, path, MAX_SKILL_OUTPUT_BYTES, canonicalDocument)
    const parsed = parseSkillDocument(text)
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
    formatSkill(skill, 'SKILL.md', text)
    return {
      skills: [skill],
      diagnostics: parsed.warnings.map((message) => ({ source: root.source, path, message }))
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
                path,
                message: error instanceof Error ? error.message : 'Unknown filesystem error',
                rejectedCanonicalDocument: hasValidatedRootContainment
                  ? undefined
                  : canonicalDocument
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
      skills: results.flatMap((result) => result.skills),
      diagnostics: results.flatMap((result) => result.diagnostics)
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
      return formatSkill(skill, relativePath, skill.document)
    if ((await realpath(skill.lexicalDirectory)) !== skill.metadata.baseDirectory) {
      throw new Error(
        'Skill directory changed after this turn started. Start a new turn to rediscover it.'
      )
    }
    const prefix = formatSkill(skill, relativePath, '')
    const budget = MAX_SKILL_OUTPUT_BYTES - Buffer.byteLength(prefix, 'utf8')
    const text = await readSkillFile(skill.metadata.baseDirectory, path, budget)
    return formatSkill(skill, relativePath, text)
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
      source: 'user-agents',
      path: join(resolve(userHome), '.agents', 'skills'),
      owner: resolve(userHome)
    },
    {
      source: 'user-claude',
      path: join(resolve(userHome), '.claude', 'skills'),
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
    .filter((skill) => !registered.includes(skill))
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
      return formatSkill(skill, 'SKILL.md', skill.body)
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
      return formatSkill(skill, 'SKILL.md', skill.body)
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
