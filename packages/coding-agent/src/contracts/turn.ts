import type { UIMessageChunk } from 'ai'
import * as z from 'zod'
import { type ContextMeasurement, ContextMeasurementSchema } from './context-measurement'
import { PermissionModeSchema } from './permissions'

import { ChatUserMessageSchema, ThinkingSelectionSchema } from './chat'
import { SessionIdSchema } from './session'

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
  | { type: 'context-measurement'; requestId: string; measurement: ContextMeasurement }
  | {
      type: 'retry'
      requestId: string
      attempt: number
      maxAttempts: number
      retryDelayMs: number
    }
  | TurnTerminalEvent

const TurnRequestIdSchema = z.string().trim().min(1)
const TurnStartRequestSchema = z.object({
  requestId: TurnRequestIdSchema,
  sessionId: SessionIdSchema,
  userMessage: ChatUserMessageSchema,
  thinkingEffort: ThinkingSelectionSchema.optional(),
  permissionMode: PermissionModeSchema.optional(),
  retry: z.boolean().optional(),
  retryRunId: z.string().trim().min(1).optional()
})
const TurnStreamEventSchema: z.ZodType<TurnStreamEvent> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('chunk'),
    requestId: TurnRequestIdSchema,
    chunk: z.custom<UIMessageChunk>()
  }),
  z.object({
    type: z.literal('context-measurement'),
    requestId: TurnRequestIdSchema,
    measurement: ContextMeasurementSchema
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

type TurnStartRequest = z.infer<typeof TurnStartRequestSchema>

export {
  type ToolOutputDeltaData,
  TurnRequestIdSchema,
  type TurnStartRequest,
  TurnStartRequestSchema,
  type TurnStreamEvent,
  TurnStreamEventSchema,
  type TurnTerminalEvent
}
