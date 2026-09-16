import * as z from 'zod'

import {
  PersistedSessionSchema,
  SessionIdSchema,
  SessionSummarySchema,
  SessionTitleSchema
} from '../../data/schemas/session'
import { ThinkingSelectionSchema } from '../../data/schemas/chat'
import { ModelEntryIdSchema } from '../../data/schemas/provider'
import { defineRoute } from '../define'

interface SessionsAPI {
  create: (input: { title: string }) => Promise<z.infer<typeof SessionSummarySchema>>
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

const createSessionRequestSchema = defineRoute({
  input: z.object({ title: SessionTitleSchema }),
  output: SessionSummarySchema
})
const renameSessionRequestSchema = defineRoute({
  input: z.object({ sessionId: SessionIdSchema, title: SessionTitleSchema }),
  output: SessionSummarySchema
})
const sessionsRequestSchemas = {
  'sessions.create': createSessionRequestSchema,
  'sessions.delete': defineRoute({ input: SessionIdSchema, output: z.void() }),
  'sessions.list': defineRoute({ input: z.void(), output: z.array(SessionSummarySchema) }),
  'sessions.load': defineRoute({ input: SessionIdSchema, output: PersistedSessionSchema }),
  'sessions.rename': renameSessionRequestSchema,
  'sessions.set-thinking-effort': defineRoute({
    input: z.object({ sessionId: SessionIdSchema, thinkingEffort: ThinkingSelectionSchema }),
    output: z.void()
  }),
  'sessions.set-model-entry': defineRoute({
    input: z.object({ sessionId: SessionIdSchema, modelEntryId: ModelEntryIdSchema }),
    output: z.void()
  })
}

export { sessionsRequestSchemas, type SessionsAPI }
