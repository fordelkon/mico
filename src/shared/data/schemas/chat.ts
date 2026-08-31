import * as z from 'zod'

import type { UIMessageChunk } from 'ai'

import { defineSchema } from '../define'

const ChatRequestIdSchema = defineSchema(z.string().trim().min(1))
const ChatMessageRoleSchema = defineSchema(z.enum(['system', 'user', 'assistant']))
const ChatTextPartSchema = defineSchema(
  z.object({ type: z.literal('text'), text: z.string().trim().min(1) })
)
const ChatMessageSchema = defineSchema(
  z.object({
    role: ChatMessageRoleSchema,
    parts: z.array(ChatTextPartSchema).min(1)
  })
)
const ChatStartRequestSchema = defineSchema(
  z.object({ requestId: ChatRequestIdSchema, messages: z.array(ChatMessageSchema) })
)
const ChatStreamEventSchema = defineSchema(
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('chunk'),
      requestId: ChatRequestIdSchema,
      chunk: z.custom<UIMessageChunk>()
    }),
    z.object({
      type: z.literal('error'),
      requestId: ChatRequestIdSchema,
      message: z.string().min(1)
    }),
    z.object({
      type: z.literal('retry'),
      requestId: ChatRequestIdSchema,
      attempt: z.number().int().min(2),
      maxAttempts: z.number().int().min(2),
      retryDelayMs: z.number().int().min(0)
    }),
    z.object({ type: z.literal('finish'), requestId: ChatRequestIdSchema })
  ])
)

const chatDataSchemas = {
  chatMessage: ChatMessageSchema,
  chatStartRequest: ChatStartRequestSchema,
  chatStreamEvent: ChatStreamEventSchema
}

type ChatMessage = z.infer<typeof ChatMessageSchema>
type ChatStartRequest = z.infer<typeof ChatStartRequestSchema>
type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>

export {
  ChatMessageRoleSchema,
  ChatMessageSchema,
  ChatRequestIdSchema,
  ChatStartRequestSchema,
  ChatStreamEventSchema,
  ChatTextPartSchema,
  chatDataSchemas
}
export type { ChatMessage, ChatStartRequest, ChatStreamEvent }
