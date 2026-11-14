import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { JsonDocument } from '@main/data/atomic-json'

import {
  MAX_MEMORY_SEARCH_BYTES,
  MemoryForgetInputSchema,
  MemoryRememberInputSchema,
  MemorySearchInputSchema,
  type MemoryContext,
  type MemoryForgetInput,
  type MemoryReceipt,
  type MemoryRecord,
  type MemoryRememberInput,
  type MemoryScope,
  type MemorySearchInput,
  type MemorySearchResult
} from '@mico/coding-agent'
import {
  MAX_MEMORY_DOCUMENT_BYTES,
  MAX_MEMORY_PREFERENCES_BYTES,
  MAX_MEMORY_RECORDS,
  MemoryDocumentSchema,
  type MemoryDocument,
  type StoredRecord
} from './schema'

interface MemoriesOptions {
  directory: string
}

interface MemoryBinding {
  projectId?: string | null
}

interface BoundScope {
  scope: MemoryScope
  filename: string
  projectId?: string
}

/** One main-process owner per directory; each scope shares one serialized document. */
class Memories {
  readonly #directory: string
  readonly #documents = new Map<string, Promise<JsonDocument<MemoryDocument>>>()

  constructor({ directory }: MemoriesOptions) {
    this.#directory = resolve(directory)
  }

  openContext({ projectId }: MemoryBinding = {}): MemoryContext {
    if (
      projectId !== undefined &&
      projectId !== null &&
      (!projectId.trim() || projectId.length > 512)
    )
      throw new Error(
        'The memory project identity is invalid. Select a registered project and retry.'
      )
    const user: BoundScope = { scope: 'user', filename: 'user.json' }
    const project: BoundScope | undefined = projectId
      ? {
          scope: 'project',
          projectId,
          filename: `project-${createHash('sha256').update(projectId).digest('hex')}.json`
        }
      : undefined
    const scopes = project ? [project, user] : [user]
    const select = (scope: MemoryScope): BoundScope => {
      if (scope === 'user') return user
      if (!project)
        throw new Error(
          'Project memory is unavailable here. Select a registered project and retry.'
        )
      return project
    }
    return {
      preferences: async () => {
        const records = await this.#records(scopes)
        const seen = new Set<string>()
        const lines: string[] = []
        let bytes = 0
        for (const record of records) {
          if (record.category !== 'user' && record.category !== 'feedback') continue
          if (seen.has(record.key)) continue
          seen.add(record.key)
          const { content: _content, ...summary } = record
          const line = JSON.stringify(summary)
          const nextBytes = Buffer.byteLength(line, 'utf8') + (lines.length ? 1 : 0)
          if (bytes + nextBytes > MAX_MEMORY_PREFERENCES_BYTES) continue
          lines.push(line)
          bytes += nextBytes
        }
        return lines.join('\n')
      },
      search: async (input) => this.#search(input, scopes, select),
      remember: async (input, signal) => {
        const parsed = MemoryRememberInputSchema.parse(input)
        return this.#mutate(select(parsed.scope), parsed, false, signal)
      },
      forget: async (input, signal) => {
        const parsed = MemoryForgetInputSchema.parse(input)
        return this.#mutate(select(parsed.scope), parsed, true, signal)
      }
    }
  }

  async #search(
    input: MemorySearchInput,
    scopes: readonly BoundScope[],
    select: (scope: MemoryScope) => BoundScope
  ): Promise<MemorySearchResult> {
    const { query, scope, limit = 10 } = MemorySearchInputSchema.parse(input)
    const terms = query.toLocaleLowerCase('en').split(/\s+/u)
    const matches = (await this.#records(scope ? [select(scope)] : scopes)).filter((record) => {
      const text = `${record.key}\n${record.summary}\n${record.content}`.toLocaleLowerCase('en')
      return terms.every((term) => text.includes(term))
    })
    const result: MemorySearchResult = { records: [], truncated: false }
    for (const record of matches) {
      const candidate = { records: [...result.records, record], truncated: true }
      if (
        result.records.length >= limit ||
        Buffer.byteLength(JSON.stringify(candidate), 'utf8') > MAX_MEMORY_SEARCH_BYTES
      ) {
        result.truncated = true
        continue
      }
      result.records.push(record)
    }
    return result
  }

  async #records(scopes: readonly BoundScope[]): Promise<MemoryRecord[]> {
    const documents = await Promise.all(scopes.map((scope) => this.#document(scope)))
    return scopes.flatMap((scope, index) =>
      documents[index].value.records
        .filter((record): record is Extract<StoredRecord, { deleted: false }> => !record.deleted)
        .sort(
          (left, right) =>
            right.updatedAt - left.updatedAt || left.key.localeCompare(right.key, 'en')
        )
        .map(({ deleted: _deleted, ...record }) => {
          const scoped = { ...record, scope: scope.scope }
          if (scope.projectId) return { ...scoped, projectId: scope.projectId }
          return scoped
        })
    )
  }

  async #mutate(
    scope: BoundScope,
    input: MemoryRememberInput | MemoryForgetInput,
    deleted: boolean,
    signal?: AbortSignal
  ): Promise<MemoryReceipt> {
    signal?.throwIfAborted()
    const document = await this.#document(scope)
    const committed = await document.update((current) => {
      // Check inside the shared queue: an earlier write may have changed this key.
      signal?.throwIfAborted()
      const existing = current.records.find(({ key }) => key === input.key)
      if (!existing && current.records.length >= MAX_MEMORY_RECORDS)
        throw new Error(
          'This memory scope has reached its 200-key limit, including deleted keys. Update an existing key instead.'
        )
      const revision = existing?.revision ?? 0
      if ((input.expectedRevision ?? 0) !== revision) {
        if (existing?.deleted)
          throw new Error(
            `Memory "${input.key}" was deleted (current revision ${revision}). Only recreate it when explicitly requested by the user, using expectedRevision ${revision}.`
          )
        throw new Error(
          `Memory "${input.key}" changed (current revision ${revision}). Search again and retry with its revision.`
        )
      }
      if (revision === Number.MAX_SAFE_INTEGER)
        throw new Error('This memory reached its revision limit. Use a new memory key.')
      const metadata = { key: input.key, revision: revision + 1, updatedAt: Date.now() }
      let record: StoredRecord
      if (deleted) record = { ...metadata, deleted: true }
      else {
        const remembered = MemoryRememberInputSchema.parse(input)
        record = {
          ...metadata,
          deleted: false,
          category: remembered.category,
          summary: remembered.summary,
          content: remembered.content
        }
      }
      const next = MemoryDocumentSchema.parse({
        version: 1,
        records: [...current.records.filter(({ key }) => key !== input.key), record]
      })
      if (Buffer.byteLength(JSON.stringify(next), 'utf8') > MAX_MEMORY_DOCUMENT_BYTES)
        throw new Error(
          'Memory storage exceeds its 2 MiB limit. Shorten existing memories before retrying.'
        )
      return next
    })
    const record = committed.records.find(({ key }) => key === input.key)
    if (!record)
      throw new Error('The memory write did not produce a receipt. Search before retrying.')
    return {
      scope: scope.scope,
      key: record.key,
      revision: record.revision,
      deleted: record.deleted
    }
  }

  #document(scope: BoundScope): Promise<JsonDocument<MemoryDocument>> {
    const cached = this.#documents.get(scope.filename)
    if (cached) return cached
    const pending = this.#loadDocument(join(this.#directory, scope.filename))
    this.#documents.set(scope.filename, pending)
    void pending.catch(() => {
      if (this.#documents.get(scope.filename) === pending) this.#documents.delete(scope.filename)
    })
    return pending
  }

  async #loadDocument(filePath: string): Promise<JsonDocument<MemoryDocument>> {
    let value: MemoryDocument
    try {
      const metadata = await stat(filePath)
      if (metadata.size > MAX_MEMORY_DOCUMENT_BYTES)
        throw new Error(
          'Memory storage exceeds its 2 MiB limit. Restore a valid memory document and retry.'
        )
      const text = await readFile(filePath, 'utf8')
      if (Buffer.byteLength(text, 'utf8') > MAX_MEMORY_DOCUMENT_BYTES)
        throw new Error(
          'Memory storage exceeds its 2 MiB limit. Restore a valid memory document and retry.'
        )
      const parsed: unknown = JSON.parse(text)
      value = MemoryDocumentSchema.parse(parsed)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        value = { version: 1, records: [] }
      else
        throw new Error(
          'Cannot load memory storage. Restore a valid memory document or fix directory access, then retry.',
          { cause: error }
        )
    }
    return new JsonDocument(filePath, value)
  }
}

export { Memories }
