import * as z from 'zod'

import {
  PersistedSessionSchema,
  SessionIdSchema,
  SessionSummarySchema,
  SessionTitleSchema
} from '../../data/schemas/session'
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
  'sessions.rename': renameSessionRequestSchema
}

export { sessionsRequestSchemas, type SessionsAPI }
