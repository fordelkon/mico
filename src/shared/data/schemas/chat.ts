import * as z from 'zod'

import type { ProviderMetadata } from 'ai'

import { defineSchema } from '../define'

type ChatTextPart = { type: 'text'; text: string }
type ChatDocumentPart = { type: 'document'; name: string; text: string }
type ChatReasoningPart = {
  type: 'reasoning'
  text: string
  providerMetadata?: ProviderMetadata
}
type ChatMessageMetadata = { completionState?: 'complete' | 'stopped' }
type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  parts: Array<ChatTextPart | ChatDocumentPart | ChatReasoningPart>
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
const CodeDocumentExtensions = [
  '.c',
  '.cc',
  '.cpp',
  '.cs',
  '.css',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.py',
  '.rs',
  '.sh',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml'
] as const
const CodeDocumentMaxNameLength = 200
const CodeDocumentMaxTextBytes = 256 * 1024
const CodeDocumentsMaxTextBytes = 1024 * 1024
const textEncoder = new TextEncoder()
const ChatDocumentPartSchema: z.ZodType<ChatDocumentPart> = defineSchema(
  z.object({
    type: z.literal('document'),
    name: z
      .string()
      .trim()
      .min(1)
      .max(CodeDocumentMaxNameLength)
      .refine((name) => CodeDocumentExtensions.some((extension) => name.endsWith(extension)), {
        message: 'Document name must use a supported code or text extension.'
      }),
    text: z
      .string()
      .refine((text) => textEncoder.encode(text).byteLength <= CodeDocumentMaxTextBytes, {
        message: 'Document text must not exceed 256 KiB.'
      })
  })
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
const ChatMessagePartsSchema = defineSchema(
  z
    .array(z.union([ChatTextPartSchema, ChatDocumentPartSchema, ChatReasoningPartSchema]))
    .min(1)
    .refine(
      (parts) =>
        parts.reduce(
          (total, part) =>
            total + (part.type === 'document' ? textEncoder.encode(part.text).byteLength : 0),
          0
        ) <= CodeDocumentsMaxTextBytes,
      { message: 'Attached documents must not exceed 1 MiB in total.' }
    )
)
const ChatMessageObjectSchema = z.object({
  role: ChatMessageRoleSchema,
  parts: ChatMessagePartsSchema,
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
  ChatDocumentPartSchema,
  ChatReasoningPartSchema,
  ChatUserMessageSchema,
  ModelReasoningCapabilitiesSchema,
  ThinkingSelectionSchema,
  CodeDocumentExtensions,
  CodeDocumentMaxNameLength,
  CodeDocumentMaxTextBytes,
  CodeDocumentsMaxTextBytes,
  chatDataSchemas
}
export type {
  ChatDocumentPart,
  ChatMessage,
  ChatUserMessage,
  ModelReasoningCapabilities,
  ThinkingSelection
}
