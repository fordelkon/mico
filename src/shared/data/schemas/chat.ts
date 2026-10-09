import type { ProviderMetadata } from 'ai'
import * as z from 'zod'
import { type ChatSkillInvocationPart, ChatSkillInvocationPartSchema } from '../../ai/skills'
import { defineSchema } from '../define'

type ChatTextPart = { type: 'text'; text: string }
type ChatDocumentPart = { type: 'document'; name: string; text: string }
type ChatReasoningPart = {
  type: 'reasoning'
  text: string
  providerMetadata?: ProviderMetadata
}
type ChatToolTraceInput = {
  command?: string
  editCount?: number
  path?: string
  query?: string
  mode?: 'files' | 'content'
  glob?: string
}
type ChatToolTracePresentation =
  | { content: string; isTruncated: boolean; type: 'bash' | 'read' | 'search' }
  | {
      content: string
      isTruncated: boolean
      operation: 'created' | 'replaced' | 'unknown'
      type: 'write'
    }
  | {
      edits: Array<{ newText: string; oldText: string }>
      isTruncated: boolean
      type: 'edit'
    }
type ChatToolTracePartBase = {
  type: 'tool-trace'
  toolCallId: string
  toolName: string
  input: ChatToolTraceInput
  presentation?: ChatToolTracePresentation
}
type ChatToolTracePart =
  | (ChatToolTracePartBase & { state: 'output-available'; output: string })
  | (ChatToolTracePartBase & { state: 'output-error'; errorText: string })
type ChatMessageMetadata = { completionState?: 'complete' | 'stopped' }
type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  parts: Array<
    | ChatTextPart
    | ChatDocumentPart
    | ChatReasoningPart
    | ChatToolTracePart
    | ChatSkillInvocationPart
  >
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
const ChatToolTraceInputSchema: z.ZodType<ChatToolTraceInput> = defineSchema(
  z.object({
    query: z.string().min(1).max(512).optional(),
    mode: z.enum(['files', 'content']).optional(),
    glob: z.string().min(1).max(512).optional(),
    command: z.string().trim().min(1).max(240).optional(),
    editCount: z.number().int().positive().max(100).optional(),
    path: z.string().trim().min(1).max(4_096).optional()
  })
)
const ToolTracePresentationMaxBytes = 64 * 1024
const isBoundedToolPresentationText = (text: string): boolean =>
  textEncoder.encode(text).byteLength <= ToolTracePresentationMaxBytes
const ChatToolTracePresentationSchema: z.ZodType<ChatToolTracePresentation> = defineSchema(
  z.discriminatedUnion('type', [
    z.object({
      type: z.enum(['bash', 'read', 'search']),
      content: z.string().refine(isBoundedToolPresentationText),
      isTruncated: z.boolean()
    }),
    z.object({
      type: z.literal('write'),
      content: z.string().refine(isBoundedToolPresentationText),
      isTruncated: z.boolean(),
      operation: z.enum(['created', 'replaced', 'unknown'])
    }),
    z.object({
      type: z.literal('edit'),
      edits: z.array(z.object({ oldText: z.string(), newText: z.string() })).max(100),
      isTruncated: z.boolean()
    })
  ])
)
const ChatToolTracePartSchema: z.ZodType<ChatToolTracePart> = defineSchema(
  z.union([
    z.object({
      type: z.literal('tool-trace'),
      toolCallId: z.string().trim().min(1).max(200),
      toolName: z.string().trim().min(1).max(64),
      input: ChatToolTraceInputSchema,
      presentation: ChatToolTracePresentationSchema.optional(),
      state: z.literal('output-available'),
      output: z.string().trim().min(1).max(500)
    }),
    z.object({
      type: z.literal('tool-trace'),
      toolCallId: z.string().trim().min(1).max(200),
      toolName: z.string().trim().min(1).max(64),
      input: ChatToolTraceInputSchema,
      presentation: ChatToolTracePresentationSchema.optional(),
      state: z.literal('output-error'),
      errorText: z.string().trim().min(1).max(500)
    })
  ])
)
const ChatMessagePartsSchema = defineSchema(
  z
    .array(
      z.union([
        ChatTextPartSchema,
        ChatDocumentPartSchema,
        ChatReasoningPartSchema,
        ChatToolTracePartSchema,
        ChatSkillInvocationPartSchema
      ])
    )
    .min(1)
    .refine((parts) => parts.filter((part) => part.type === 'data-skill-invocation').length <= 1, {
      message: 'A user message may invoke only one skill.'
    })
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
const ChatMessageSchema: z.ZodType<ChatMessage> = defineSchema(
  ChatMessageObjectSchema.refine(
    (message) =>
      message.role === 'user' ||
      message.parts.every((part) => part.type !== 'data-skill-invocation'),
    { message: 'Only user messages may invoke skills.' }
  )
)
const ChatUserMessageSchema: z.ZodType<ChatUserMessage> = defineSchema(
  ChatMessageObjectSchema.extend({ role: z.literal('user') })
)
const chatDataSchemas = {
  chatMessage: ChatMessageSchema,
  modelReasoningCapabilities: ModelReasoningCapabilitiesSchema
}

type ModelReasoningCapabilities = z.infer<typeof ModelReasoningCapabilitiesSchema>
type ThinkingSelection = z.infer<typeof ThinkingSelectionSchema>

export type {
  ChatDocumentPart,
  ChatMessage,
  ChatSkillInvocationPart,
  ChatToolTraceInput,
  ChatToolTracePart,
  ChatToolTracePresentation,
  ChatUserMessage,
  ModelReasoningCapabilities,
  ThinkingSelection
}
export {
  ChatDocumentPartSchema,
  ChatMessageRoleSchema,
  ChatMessageSchema,
  ChatReasoningPartSchema,
  ChatTextPartSchema,
  ChatToolTraceInputSchema,
  ChatToolTracePartSchema,
  ChatToolTracePresentationSchema,
  ChatUserMessageSchema,
  CodeDocumentExtensions,
  CodeDocumentMaxNameLength,
  CodeDocumentMaxTextBytes,
  CodeDocumentsMaxTextBytes,
  chatDataSchemas,
  ModelReasoningCapabilitiesSchema,
  ThinkingSelectionSchema
}
