import * as z from 'zod'
import { defineSchema } from '../define'
import { ChatMessageSchema, ThinkingSelectionSchema } from './chat'
import { ModelEntryIdSchema } from './provider'

const SessionIdSchema = defineSchema(z.string().trim().min(1))
const ProjectIdSchema = defineSchema(z.string().trim().min(1))
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
    projectId: ProjectIdSchema.nullable().optional(),
    cwd: z.string().trim().min(1).nullable().optional(),
    defaultProfile: ExecutionProfileSnapshotSchema.nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    lastActivityAt: z.number().int().nonnegative()
  })
)
const SessionRecoverySchema = defineSchema(
  z.object({
    runId: z.string().min(1),
    turnId: z.string().min(1),
    status: z.enum(['failed', 'interrupted']),
    failure: z.object({
      code: z.enum([
        'provider_error',
        'step_limit',
        'token_limit',
        'aborted',
        'no_model',
        'process_interrupted'
      ]),
      message: z.string()
    }),
    canRetry: z.boolean(),
    blockedReason: z.string().optional()
  })
)
type SessionRecovery = z.infer<typeof SessionRecoverySchema>
const PersistedSessionSchema = defineSchema(
  SessionSummarySchema.extend({
    messages: z.array(ChatMessageSchema),
    recovery: SessionRecoverySchema.nullable().optional()
  })
)

type ExecutionProfileSnapshot = z.infer<typeof ExecutionProfileSnapshotSchema>
type SessionSummary = z.infer<typeof SessionSummarySchema>
type PersistedSession = z.infer<typeof PersistedSessionSchema>

export type { ExecutionProfileSnapshot, PersistedSession, SessionRecovery, SessionSummary }
export {
  ExecutionProfileSnapshotSchema,
  PersistedSessionSchema,
  ProjectIdSchema,
  SessionIdSchema,
  SessionRecoverySchema,
  SessionSummarySchema,
  SessionTitleSchema
}
