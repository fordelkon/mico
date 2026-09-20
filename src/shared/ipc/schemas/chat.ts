import * as z from 'zod'

import type { UIMessageChunk } from 'ai'

import {
  ChatUserMessageSchema,
  ModelReasoningCapabilitiesSchema,
  ThinkingSelectionSchema
} from '../../data/schemas/chat'
import type { ModelReasoningCapabilities } from '../../data/schemas/chat'
import { defineSchema } from '../../data/define'
import { SessionIdSchema } from '../../data/schemas/session'
import { defineRoute } from '../define'

type TurnTerminalEvent =
  | { type: 'cancelled'; requestId: string }
  | { type: 'error'; requestId: string; message: string }
  | { type: 'finish'; requestId: string }
/** Ephemeral output emitted while a workspace tool is still executing. */
type ToolOutputDeltaData = {
  toolCallId: string
  toolName: string
  stream: 'preview' | 'stderr' | 'stdout'
  delta: string
}
type TurnStreamEvent =
  | { type: 'chunk'; requestId: string; chunk: UIMessageChunk }
  | {
      type: 'retry'
      requestId: string
      attempt: number
      maxAttempts: number
      retryDelayMs: number
    }
  | TurnTerminalEvent

const TurnRequestIdSchema = defineSchema(z.string().trim().min(1))
const ToolOutputDeltaDataSchema: z.ZodType<ToolOutputDeltaData> = defineSchema(
  z.object({
    toolCallId: z.string().trim().min(1).max(200),
    toolName: z.string().trim().min(1).max(100),
    stream: z.enum(['preview', 'stderr', 'stdout']),
    // Bounds a single IPC event; the tool-level limits bound the complete output.
    delta: z
      .string()
      .min(1)
      .max(64 * 1024)
  })
)
const TurnStartRequestSchema = defineSchema(
  z.object({
    requestId: TurnRequestIdSchema,
    sessionId: SessionIdSchema,
    userMessage: ChatUserMessageSchema,
    thinkingEffort: ThinkingSelectionSchema.optional(),
    retry: z.boolean().optional()
  })
)
const TurnStreamEventSchema: z.ZodType<TurnStreamEvent> = defineSchema(
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('chunk'),
      requestId: TurnRequestIdSchema,
      chunk: z.custom<UIMessageChunk>()
    }),
    z.object({
      type: z.literal('error'),
      requestId: TurnRequestIdSchema,
      message: z.string().min(1)
    }),
    z.object({
      type: z.literal('retry'),
      requestId: TurnRequestIdSchema,
      attempt: z.number().int().min(2),
      maxAttempts: z.number().int().min(2),
      retryDelayMs: z.number().int().min(0)
    }),
    z.object({ type: z.literal('cancelled'), requestId: TurnRequestIdSchema }),
    z.object({ type: z.literal('finish'), requestId: TurnRequestIdSchema })
  ])
)

type TurnStartRequest = z.infer<typeof TurnStartRequestSchema>

interface ChatAPI {
  getCapabilities: () => Promise<ModelReasoningCapabilities | null>
  startTurn: (request: TurnStartRequest) => Promise<void>
  abortTurn: (requestId: string) => Promise<void>
  onTurnEvent: (listener: (event: TurnStreamEvent) => void) => () => void
}

const chatIpcSchemas = {
  'chat.abort-turn': defineRoute({ input: TurnRequestIdSchema, output: z.void() }),
  'chat.get-capabilities': defineRoute({
    input: z.void(),
    output: ModelReasoningCapabilitiesSchema.nullable()
  }),
  'chat.start-turn': defineRoute({ input: TurnStartRequestSchema, output: z.void() })
}

export {
  TurnRequestIdSchema,
  TurnStartRequestSchema,
  TurnStreamEventSchema,
  ToolOutputDeltaDataSchema,
  chatIpcSchemas,
  type ChatAPI,
  type TurnStartRequest,
  type TurnStreamEvent,
  type TurnTerminalEvent,
  type ToolOutputDeltaData
}
