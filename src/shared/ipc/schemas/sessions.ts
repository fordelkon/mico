import * as z from 'zod'
import { defineSchema } from '../../data/define'
import { ProjectIdSchema, SessionIdSchema, SessionTitleSchema } from '../../data/schemas/session'
import { IpcChannel } from '../../IpcChannel'
import type { IpcMethod } from '../contracts'

interface SessionsAPI {
  compact: IpcMethod<IpcChannel.Sessions_Compact>
  cancelCompact: IpcMethod<IpcChannel.Sessions_CancelCompact>
  create: IpcMethod<IpcChannel.Sessions_Create>
  delete: IpcMethod<IpcChannel.Sessions_Delete>
  list: IpcMethod<IpcChannel.Sessions_List>
  load: IpcMethod<IpcChannel.Sessions_Load>
  rename: IpcMethod<IpcChannel.Sessions_Rename>
  setThinkingEffort: IpcMethod<IpcChannel.Sessions_SetThinkingEffort>
  setModelEntry: IpcMethod<IpcChannel.Sessions_SetModelEntry>
  onTitleUpdated: (listener: (update: { sessionId: string; title: string }) => void) => () => void
}

const CreateSessionRequestSchema = defineSchema(
  z.object({ title: SessionTitleSchema, projectId: ProjectIdSchema.optional() })
)

/**
 * Durable terminal outcome of one manual summary. `accepted` carries the
 * checkpoint id recorded with the summary; `cancelled` and `failed` are
 * recorded as durable notices before the outcome reaches the renderer.
 */
const CompactionOutcomeSchema = defineSchema(
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('accepted'), checkpointEventId: z.string().min(1) }),
    z.object({ status: z.literal('cancelled') }),
    z.object({ status: z.literal('failed'), message: z.string().min(1) })
  ])
)

const CompactionRequestSchema = defineSchema(
  z.strictObject({ sessionId: SessionIdSchema, requestId: z.string().trim().min(1).max(200) })
)

type CompactionOutcome = z.output<typeof CompactionOutcomeSchema>

export {
  type CompactionOutcome,
  CompactionOutcomeSchema,
  CompactionRequestSchema,
  CreateSessionRequestSchema,
  type SessionsAPI
}
