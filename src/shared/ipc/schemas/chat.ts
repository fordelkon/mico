import * as z from 'zod'

import { ChatRequestIdSchema, ChatStartRequestSchema } from '../../data/schemas/chat'
import type { ChatStartRequest, ChatStreamEvent } from '../../data/schemas/chat'
import { defineRoute } from '../define'

interface ChatAPI {
  start: (request: ChatStartRequest) => Promise<void>
  abort: (requestId: string) => Promise<void>
  onEvent: (listener: (event: ChatStreamEvent) => void) => () => void
}

const chatRequestSchemas = {
  'chat.abort': defineRoute({ input: ChatRequestIdSchema, output: z.void() }),
  'chat.start': defineRoute({ input: ChatStartRequestSchema, output: z.void() })
}

export { chatRequestSchemas, type ChatAPI }
