import * as z from 'zod'

import type { ProviderMetadata, UIMessageChunk } from 'ai'

import { defineSchema } from '../define'

type ChatTextPart = { type: 'text'; text: string }
type ChatReasoningPart = {
  type: 'reasoning'
  text: string
  providerMetadata?: ProviderMetadata
}
type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  parts: Array<ChatTextPart | ChatReasoningPart>
  providerMetadata?: ProviderMetadata
}
type ChatStreamEvent =
  | { type: 'chunk'; requestId: string; chunk: UIMessageChunk }
  | { type: 'error'; requestId: string; message: string }
  | {
      type: 'retry'
      requestId: string
      attempt: number
      maxAttempts: number
      retryDelayMs: number
    }
  | { type: 'finish'; requestId: string }

const ChatRequestIdSchema = defineSchema(z.string().trim().min(1))
const ChatConversationIdSchema = defineSchema(z.string().trim().min(1))
const ThinkingSelectionSchema = defineSchema(
  z.enum(['default', 'none', 'auto', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
)
const ModelReasoningCapabilitiesSchema = defineSchema(
  z.object({
    availability: z.enum(['supported', 'unknown']).optional(),
    selectableEfforts: z.array(ThinkingSelectionSchema).min(2),
    defaultEffort: ThinkingSelectionSchema
  })
)
const ChatMessageRoleSchema = defineSchema(z.enum(['system', 'user', 'assistant']))
const ChatTextPartSchema = defineSchema(
  z.object({ type: z.literal('text'), text: z.string().trim().min(1) })
)
// Keep the exported schema's declaration on the public `ai` types instead of
// allowing Zod inference to expose pnpm's private @ai-sdk/provider path.
const ChatReasoningPartSchema: z.ZodType<ChatReasoningPart> = defineSchema(
  z.object({
    type: z.literal('reasoning'),
    text: z.string().min(1),
    providerMetadata: z.custom<ProviderMetadata>().optional()
  })
)
const ChatMessageSchema: z.ZodType<ChatMessage> = defineSchema(
  z.object({
    role: ChatMessageRoleSchema,
    parts: z.array(z.union([ChatTextPartSchema, ChatReasoningPartSchema])).min(1),
    providerMetadata: z.custom<ProviderMetadata>().optional()
  })
)
const ChatStartRequestSchema = defineSchema(
  z.object({
    requestId: ChatRequestIdSchema,
    conversationId: ChatConversationIdSchema,
    messages: z.array(ChatMessageSchema),
    thinkingEffort: ThinkingSelectionSchema.optional()
  })
)
const ChatStreamEventSchema: z.ZodType<ChatStreamEvent> = defineSchema(
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
  chatConversationId: ChatConversationIdSchema,
  modelReasoningCapabilities: ModelReasoningCapabilitiesSchema,
  chatStartRequest: ChatStartRequestSchema,
  chatStreamEvent: ChatStreamEventSchema
}

type ChatStartRequest = z.infer<typeof ChatStartRequestSchema>
type ModelReasoningCapabilities = z.infer<typeof ModelReasoningCapabilitiesSchema>
type ThinkingSelection = z.infer<typeof ThinkingSelectionSchema>

export {
  ChatMessageRoleSchema,
  ChatMessageSchema,
  ChatConversationIdSchema,
  ChatRequestIdSchema,
  ChatStartRequestSchema,
  ChatStreamEventSchema,
  ChatTextPartSchema,
  ChatReasoningPartSchema,
  ModelReasoningCapabilitiesSchema,
  ThinkingSelectionSchema,
  chatDataSchemas
}
export type {
  ChatMessage,
  ChatStartRequest,
  ChatStreamEvent,
  ModelReasoningCapabilities,
  ThinkingSelection
}
