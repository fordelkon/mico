import * as z from 'zod'

import type { ProviderMetadata } from 'ai'

import { defineSchema } from '../define'

type ChatTextPart = { type: 'text'; text: string }
type ChatReasoningPart = {
  type: 'reasoning'
  text: string
  providerMetadata?: ProviderMetadata
}
type ChatMessageMetadata = { completionState?: 'complete' | 'stopped' }
type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  parts: Array<ChatTextPart | ChatReasoningPart>
  metadata?: ChatMessageMetadata
  providerMetadata?: ProviderMetadata
}
type ChatUserMessage = Omit<ChatMessage, 'role'> & { role: 'user' }
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
const ChatMessageObjectSchema = z.object({
  role: ChatMessageRoleSchema,
  parts: z.array(z.union([ChatTextPartSchema, ChatReasoningPartSchema])).min(1),
  metadata: z.object({ completionState: z.enum(['complete', 'stopped']).optional() }).optional(),
  providerMetadata: z.custom<ProviderMetadata>().optional()
})
const ChatMessageSchema: z.ZodType<ChatMessage> = defineSchema(ChatMessageObjectSchema)
const ChatUserMessageSchema: z.ZodType<ChatUserMessage> = defineSchema(
  ChatMessageObjectSchema.extend({ role: z.literal('user') })
)
const chatDataSchemas = {
  chatMessage: ChatMessageSchema,
  modelReasoningCapabilities: ModelReasoningCapabilitiesSchema
}

type ModelReasoningCapabilities = z.infer<typeof ModelReasoningCapabilitiesSchema>
type ThinkingSelection = z.infer<typeof ThinkingSelectionSchema>

export {
  ChatMessageRoleSchema,
  ChatMessageSchema,
  ChatTextPartSchema,
  ChatReasoningPartSchema,
  ChatUserMessageSchema,
  ModelReasoningCapabilitiesSchema,
  ThinkingSelectionSchema,
  chatDataSchemas
}
export type { ChatMessage, ChatUserMessage, ModelReasoningCapabilities, ThinkingSelection }
