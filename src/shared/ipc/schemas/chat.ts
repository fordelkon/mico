import * as z from 'zod'

import {
  ChatRequestIdSchema,
  ChatStartRequestSchema,
  ModelReasoningCapabilitiesSchema
} from '../../data/schemas/chat'
import type {
  ChatStartRequest,
  ChatStreamEvent,
  ModelReasoningCapabilities
} from '../../data/schemas/chat'
import { defineRoute } from '../define'

interface ChatAPI {
  getCapabilities: () => Promise<ModelReasoningCapabilities | null>
  start: (request: ChatStartRequest) => Promise<void>
  abort: (requestId: string) => Promise<void>
  onEvent: (listener: (event: ChatStreamEvent) => void) => () => void
}

const chatRequestSchemas = {
  'chat.abort': defineRoute({ input: ChatRequestIdSchema, output: z.void() }),
  'chat.get-capabilities': defineRoute({
    input: z.void(),
    output: ModelReasoningCapabilitiesSchema.nullable()
  }),
  'chat.start': defineRoute({ input: ChatStartRequestSchema, output: z.void() })
}

export { chatRequestSchemas, type ChatAPI }
