import * as z from 'zod'
import { MemoryRememberInputSchema } from '@mico/coding-agent'

const MAX_MEMORY_RECORDS = 200
const MAX_MEMORY_DOCUMENT_BYTES = 2 * 1024 * 1024
const MAX_MEMORY_PREFERENCES_BYTES = 8 * 1024

const lifecycle = {
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  updatedAt: z.number().int().nonnegative()
}
const StoredRecordSchema = z.discriminatedUnion('deleted', [
  MemoryRememberInputSchema.pick({
    key: true,
    category: true,
    summary: true,
    content: true
  }).extend({ ...lifecycle, deleted: z.literal(false) }),
  MemoryRememberInputSchema.pick({ key: true }).extend({ ...lifecycle, deleted: z.literal(true) })
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

type MemoryDocument = z.infer<typeof MemoryDocumentSchema>
type StoredRecord = z.infer<typeof StoredRecordSchema>

export {
  MAX_MEMORY_DOCUMENT_BYTES,
  MAX_MEMORY_PREFERENCES_BYTES,
  MAX_MEMORY_RECORDS,
  MemoryDocumentSchema
}
export type { MemoryDocument, StoredRecord }
