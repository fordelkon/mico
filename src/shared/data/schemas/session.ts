import * as z from 'zod'

import { ChatMessageSchema, ThinkingSelectionSchema } from './chat'
import { ModelEntryIdSchema } from './provider'
import { defineSchema } from '../define'

const SessionIdSchema = defineSchema(z.string().trim().min(1))
const SessionTitleSchema = defineSchema(z.string().trim().min(1).max(200))
const ExecutionProfileSnapshotSchema = defineSchema(
  z.object({
    modelEntryId: ModelEntryIdSchema,
    providerId: z.string().trim().min(1),
    modelId: z.string().trim().min(1),
    thinkingEffort: ThinkingSelectionSchema,
    configurationDigest: z.string().trim().min(1)
  })
)
const SessionSummarySchema = defineSchema(
  z.object({
    id: SessionIdSchema,
    title: SessionTitleSchema,
    defaultProfile: ExecutionProfileSnapshotSchema.nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    lastActivityAt: z.number().int().nonnegative()
  })
)
const PersistedSessionSchema = defineSchema(
  SessionSummarySchema.extend({ messages: z.array(ChatMessageSchema) })
)

type ExecutionProfileSnapshot = z.infer<typeof ExecutionProfileSnapshotSchema>
type SessionSummary = z.infer<typeof SessionSummarySchema>
type PersistedSession = z.infer<typeof PersistedSessionSchema>

export {
  ExecutionProfileSnapshotSchema,
  PersistedSessionSchema,
  SessionIdSchema,
  SessionSummarySchema,
  SessionTitleSchema
}
export type { ExecutionProfileSnapshot, PersistedSession, SessionSummary }
