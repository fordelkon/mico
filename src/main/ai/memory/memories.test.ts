import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  MAX_MEMORY_PREFERENCES_BYTES,
  MAX_MEMORY_SEARCH_BYTES,
  Memories,
  type MemoryContext,
  type MemoryRememberInput
} from './index'

const preference: MemoryRememberInput = {
  scope: 'user',
  key: 'answer-language',
  category: 'user',
  summary: 'Answer in Chinese.',
  content: 'The user prefers answers in Chinese.'
}

describe('Memories', () => {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
    )
  })

  async function createOwner(): Promise<{
    owner: Memories
    directory: string
    context: MemoryContext
  }> {
    const directory = await mkdtemp(join(tmpdir(), 'mico-memory-'))
    directories.push(directory)
    const owner = new Memories({ directory })
    return { owner, directory, context: owner.openContext({ projectId: 'project-a' }) }
  }

  it('user starts a new session when preferences were saved, then summaries survive reopening', async () => {
    const { owner, directory, context } = await createOwner()
    expect(await context.remember(preference)).toEqual({
      scope: 'user',
      key: preference.key,
      revision: 1,
      deleted: false
    })
    await context.remember({
      ...preference,
      scope: 'project',
      summary: 'Answer briefly in Chinese.',
      content: 'Project-specific preference.'
    })
    await context.remember({
      ...preference,
      key: 'build-command',
      category: 'project',
      summary: 'Use pnpm.',
      content: 'Use pnpm for this project.'
    })

    const reopened = new Memories({ directory }).openContext({ projectId: 'project-a' })
    const summaries = (await reopened.preferences()).split('\n').map((line) => {
      const value: unknown = JSON.parse(line)
      return value
    })
    expect(summaries).toEqual([
      expect.objectContaining({
        scope: 'project',
        projectId: 'project-a',
        key: preference.key,
        summary: 'Answer briefly in Chinese.',
        revision: 1
      })
    ])
    expect(await reopened.preferences()).not.toContain('Project-specific preference.')
    expect(await owner.openContext({ projectId: 'project-b' }).preferences()).toContain(
      'Answer in Chinese.'
    )
    expect(await reopened.search({ query: 'Project-specific' })).toMatchObject({
      records: [{ content: 'Project-specific preference.' }],
      truncated: false
    })
  })

  it('user switches projects when memories exist, then only shared and bound project records are visible', async () => {
    const { owner, directory, context } = await createOwner()
    await context.remember(preference)
    await context.remember({
      ...preference,
      scope: 'project',
      key: 'private-detail',
      summary: 'Private project detail.',
      content: 'Private project content.'
    })
    const other = owner.openContext({ projectId: '../../project-b' })
    expect((await other.search({ query: 'project' })).records).toEqual([])
    expect((await other.search({ query: 'Chinese' })).records).toMatchObject([
      { scope: 'user', key: preference.key }
    ])
    const unbound = owner.openContext({ projectId: null })
    await expect(unbound.remember({ ...preference, scope: 'project' })).rejects.toThrow(
      'Project memory is unavailable'
    )
    await expect(unbound.search({ query: 'private', scope: 'project' })).rejects.toThrow(
      'Project memory is unavailable'
    )
    await expect(
      unbound.forget({ scope: 'project', key: preference.key, expectedRevision: 0 })
    ).rejects.toThrow('Project memory is unavailable')
    await other.remember({ ...preference, scope: 'project' })
    expect((await readdir(directory)).filter((name) => name.startsWith('project-'))).toHaveLength(2)
    expect((await readdir(directory)).every((name) => !name.includes('project-b'))).toBe(true)
  })

  it('user saves from concurrent sessions when storage is cold, then all distinct keys survive restart', async () => {
    const { owner, directory } = await createOwner()
    const first = owner.openContext({ projectId: 'project-a' })
    const second = owner.openContext({ projectId: 'project-a' })
    await Promise.all([
      first.remember({ ...preference, scope: 'project', key: 'first' }),
      second.remember({ ...preference, scope: 'project', key: 'second' })
    ])
    const restored = new Memories({ directory }).openContext({ projectId: 'project-a' })
    const result = await restored.search({ query: 'Chinese', scope: 'project' })
    expect(result.records.map(({ key }) => key).sort()).toEqual(['first', 'second'])
  })

  it('user updates one key concurrently when revisions match, then only one update commits', async () => {
    const { context } = await createOwner()
    await context.remember(preference)
    await expect(context.remember({ ...preference, summary: 'Missing version.' })).rejects.toThrow(
      'current revision 1'
    )
    const outcomes = await Promise.allSettled([
      context.remember({ ...preference, summary: 'First change.', expectedRevision: 1 }),
      context.remember({ ...preference, summary: 'Second change.', expectedRevision: 1 })
    ])
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect((await context.search({ query: 'Chinese' })).records).toMatchObject([
      { summary: 'First change.', revision: 2 }
    ])
  })

  it('user forgets a preference when an old write arrives, then deletion survives the stale write and restart', async () => {
    const { directory, context } = await createOwner()
    await context.remember(preference)
    expect(
      await context.forget({ scope: 'user', key: preference.key, expectedRevision: 1 })
    ).toEqual({ scope: 'user', key: preference.key, revision: 2, deleted: true })
    const restored = new Memories({ directory }).openContext({})
    await expect(restored.remember({ ...preference, expectedRevision: 1 })).rejects.toThrow(
      'current revision 2'
    )
    await expect(restored.remember(preference)).rejects.toThrow(
      'was deleted (current revision 2). Only recreate it when explicitly requested by the user, using expectedRevision 2.'
    )
    expect(await restored.preferences()).toBe('')
    expect((await restored.search({ query: 'Chinese' })).records).toEqual([])
    expect(await restored.remember({ ...preference, expectedRevision: 2 })).toMatchObject({
      revision: 3,
      deleted: false
    })
  })

  it('user cancels a queued save when its scope is loaded, then no cancelled memory is committed', async () => {
    const { context, directory } = await createOwner()
    await context.search({ query: 'Chinese' })
    const controller = new AbortController()
    const saving = context.remember(preference, controller.signal)
    controller.abort(new Error('Memory save cancelled.'))
    await expect(saving).rejects.toThrow('Memory save cancelled.')
    expect(
      (await new Memories({ directory }).openContext({}).search({ query: 'Chinese' })).records
    ).toEqual([])
    expect(await context.remember(preference)).toMatchObject({ revision: 1 })
  })

  it('user retries after a storage failure when access recovers, then only committed content appears', async () => {
    const { context, directory } = await createOwner()
    await context.search({ query: 'Chinese' })
    const filePath = join(directory, 'user.json')
    await mkdir(filePath)
    await expect(context.remember(preference)).rejects.toThrow(/EPERM|EISDIR|EACCES|ENOTEMPTY/)
    expect((await context.search({ query: 'Chinese' })).records).toEqual([])
    await rm(filePath, { recursive: true })
    expect(await context.remember(preference)).toMatchObject({ revision: 1 })
    const stored: unknown = JSON.parse(await readFile(filePath, 'utf8'))
    expect(stored).toMatchObject({
      version: 1,
      records: [{ summary: preference.summary, content: preference.content, revision: 1 }]
    })
  })

  it('user opens invalid storage when it is repaired later, then corruption is rejected without overwriting it', async () => {
    const { context, directory } = await createOwner()
    const filePath = join(directory, 'user.json')
    const invalid = JSON.stringify({ version: 99, records: [] })
    await writeFile(filePath, invalid)
    await expect(context.remember(preference)).rejects.toThrow('Cannot load memory storage')
    expect(await readFile(filePath, 'utf8')).toBe(invalid)
    await writeFile(filePath, JSON.stringify({ version: 1, records: [] }))
    expect(await context.remember(preference)).toMatchObject({ revision: 1 })
  })

  it('user retrieves many memories when text is large, then preferences and full search stay within their budgets', async () => {
    const { context } = await createOwner()
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        context.remember({
          ...preference,
          key: `preference-${index}`,
          summary: '偏'.repeat(160),
          content: `memory ${'x'.repeat(4089)}`
        })
      )
    )
    const summaries = await context.preferences()
    expect(Buffer.byteLength(summaries, 'utf8')).toBeLessThanOrEqual(MAX_MEMORY_PREFERENCES_BYTES)
    expect(summaries).not.toContain('memory ')
    expect(summaries.split('\n').length).toBeLessThan(20)
    const results = await context.search({ query: 'memory', limit: 20 })
    expect(results.truncated).toBe(true)
    expect(results.records.length).toBeGreaterThan(0)
    expect(Buffer.byteLength(JSON.stringify(results), 'utf8')).toBeLessThanOrEqual(
      MAX_MEMORY_SEARCH_BYTES
    )
    expect((await context.search({ query: 'memory', limit: 1 })).records).toHaveLength(1)
    await expect(context.remember({ ...preference, content: '偏'.repeat(1366) })).rejects.toThrow(
      '4 KiB'
    )
  })

  it('user adds a new key when tombstones fill storage, then old deletion revisions remain protected', async () => {
    const { context, directory } = await createOwner()
    await writeFile(
      join(directory, 'user.json'),
      JSON.stringify({
        version: 1,
        records: Array.from({ length: 200 }, (_, index) => ({
          key: `deleted-${index}`,
          revision: 2,
          updatedAt: 0,
          deleted: true
        }))
      })
    )
    await expect(context.remember(preference)).rejects.toThrow('200-key limit')
    await expect(
      context.remember({ ...preference, key: 'deleted-0', expectedRevision: 1 })
    ).rejects.toThrow('current revision 2')
    expect(
      await context.remember({ ...preference, key: 'deleted-0', expectedRevision: 2 })
    ).toMatchObject({ revision: 3 })
  })
})
