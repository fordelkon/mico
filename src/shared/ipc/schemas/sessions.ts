import * as z from 'zod'

import { defineSchema } from '../../data/define'
import {
  PersistedSessionSchema,
  SessionSummarySchema,
  SessionTitleSchema,
  ProjectIdSchema
} from '../../data/schemas/session'
import { ThinkingSelectionSchema } from '../../data/schemas/chat'

interface SessionsAPI {
  create: (input: {
    title: string
    projectId?: string
  }) => Promise<z.infer<typeof SessionSummarySchema>>
  delete: (sessionId: string) => Promise<void>
  list: () => Promise<Array<z.infer<typeof SessionSummarySchema>>>
  load: (sessionId: string) => Promise<z.infer<typeof PersistedSessionSchema>>
  rename: (input: {
    sessionId: string
    title: string
  }) => Promise<z.infer<typeof SessionSummarySchema>>
  setThinkingEffort: (input: {
    sessionId: string
    thinkingEffort: z.infer<typeof ThinkingSelectionSchema>
  }) => Promise<void>
  setModelEntry: (input: { sessionId: string; modelEntryId: string }) => Promise<void>
  onTitleUpdated: (listener: (update: { sessionId: string; title: string }) => void) => () => void
}

const CreateSessionRequestSchema = defineSchema(
  z.object({ title: SessionTitleSchema, projectId: ProjectIdSchema.optional() })
)

export { CreateSessionRequestSchema, type SessionsAPI }
