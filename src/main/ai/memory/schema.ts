import * as z from 'zod'

const MAX_MEMORY_RECORDS = 200
const MAX_MEMORY_CONTENT_BYTES = 4 * 1024
const MAX_MEMORY_DOCUMENT_BYTES = 2 * 1024 * 1024
const MAX_MEMORY_SEARCH_BYTES = 16 * 1024
const MAX_MEMORY_PREFERENCES_BYTES = 8 * 1024

const MemoryScopeSchema = z.enum(['user', 'project'])
const MemoryCategorySchema = z.enum(['user', 'feedback', 'project', 'reference'])
const MemoryKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9][a-z0-9._-]*$/,
    'Use a stable lowercase key with letters, digits, dots, underscores, or hyphens.'
  )
const MemoryRevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const MemorySearchInputSchema = z.strictObject({
  query: z.string().trim().min(1).max(256),
  scope: MemoryScopeSchema.optional(),
  limit: z.number().int().min(1).max(20).optional()
})
const MemorySummarySchema = z.string().trim().min(1).max(160)
const MemoryContentSchema = z
  .string()
  .min(1)
  .max(MAX_MEMORY_CONTENT_BYTES)
  .refine((content) => Buffer.byteLength(content, 'utf8') <= MAX_MEMORY_CONTENT_BYTES, {
    message: 'Memory content must not exceed 4 KiB of UTF-8 text.'
  })
const MemoryRememberInputSchema = z.strictObject({
  scope: MemoryScopeSchema,
  key: MemoryKeySchema,
  category: MemoryCategorySchema,
  summary: MemorySummarySchema,
  content: MemoryContentSchema,
  expectedRevision: MemoryRevisionSchema.optional()
})
const MemoryForgetInputSchema = z.strictObject({
  scope: MemoryScopeSchema,
  key: MemoryKeySchema,
  expectedRevision: MemoryRevisionSchema
})
const StoredMetadataSchema = z.strictObject({
  key: MemoryKeySchema,
  revision: MemoryRevisionSchema.refine((revision) => revision > 0),
  updatedAt: z.number().int().nonnegative()
})
const StoredRecordSchema = z.discriminatedUnion('deleted', [
  StoredMetadataSchema.extend({
    deleted: z.literal(false),
    category: MemoryCategorySchema,
    summary: MemorySummarySchema,
    content: MemoryContentSchema
  }),
  StoredMetadataSchema.extend({ deleted: z.literal(true) })
])
const MemoryDocumentSchema = z
  .strictObject({
    version: z.literal(1),
    records: z.array(StoredRecordSchema).max(MAX_MEMORY_RECORDS)
  })
  .refine(
    (document) => new Set(document.records.map(({ key }) => key)).size === document.records.length,
    {
      message: 'Memory keys must be unique within a scope.'
    }
  )

type MemoryScope = z.infer<typeof MemoryScopeSchema>
type MemoryCategory = z.infer<typeof MemoryCategorySchema>
type MemorySearchInput = z.infer<typeof MemorySearchInputSchema>
type MemoryRememberInput = z.infer<typeof MemoryRememberInputSchema>
type MemoryForgetInput = z.infer<typeof MemoryForgetInputSchema>
type MemoryDocument = z.infer<typeof MemoryDocumentSchema>
type StoredRecord = z.infer<typeof StoredRecordSchema>

interface MemoryRecord {
  scope: MemoryScope
  projectId?: string
  key: string
  category: MemoryCategory
  summary: string
  content: string
  revision: number
  updatedAt: number
}

interface MemorySearchResult {
  records: MemoryRecord[]
  truncated: boolean
}

interface MemoryReceipt {
  scope: MemoryScope
  key: string
  revision: number
  deleted: boolean
}

interface MemoryContext {
  preferences(): Promise<string>
  search(input: MemorySearchInput): Promise<MemorySearchResult>
  remember(input: MemoryRememberInput, signal?: AbortSignal): Promise<MemoryReceipt>
  forget(input: MemoryForgetInput, signal?: AbortSignal): Promise<MemoryReceipt>
}

export {
  MAX_MEMORY_RECORDS,
  MAX_MEMORY_CONTENT_BYTES,
  MAX_MEMORY_DOCUMENT_BYTES,
  MAX_MEMORY_SEARCH_BYTES,
  MAX_MEMORY_PREFERENCES_BYTES,
  MemorySearchInputSchema,
  MemoryRememberInputSchema,
  MemoryForgetInputSchema,
  MemoryDocumentSchema
}
export type {
  MemoryScope,
  MemoryCategory,
  MemorySearchInput,
  MemoryRememberInput,
  MemoryForgetInput,
  MemoryDocument,
  StoredRecord,
  MemoryRecord,
  MemorySearchResult,
  MemoryReceipt,
  MemoryContext
}
