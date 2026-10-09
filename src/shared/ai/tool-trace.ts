import * as z from 'zod'

import {
  type ChatToolTracePresentation,
  ChatToolTracePresentationSchema
} from '../data/schemas/chat'

const SourceInputSchema = z.object({
  query: z.string().optional(),
  mode: z.enum(['files', 'content']).optional(),
  glob: z.string().optional(),
  command: z.string().optional(),
  content: z.string().optional(),
  file_path: z.string().optional(),
  pattern: z.string().optional(),
  old_string: z.string().optional(),
  new_string: z.string().optional(),
  path: z.string().optional(),
  skill_id: z.string().optional(),
  relative_path: z.string().optional()
})

function normalizeInput<T extends z.infer<typeof SourceInputSchema>>(input: T) {
  return {
    ...input,
    path:
      input.file_path ??
      input.path ??
      (input.skill_id ? `${input.skill_id}/${input.relative_path ?? 'SKILL.md'}` : undefined),
    query: input.pattern ?? input.query,
    edits:
      input.old_string !== undefined || input.new_string !== undefined
        ? [{ oldText: input.old_string ?? '', newText: input.new_string ?? '' }]
        : undefined
  }
}

// Execution traces retain full input until the persistence boundary applies its budget.
const ToolTraceSourceInputSchema = SourceInputSchema.transform(normalizeInput)
const ToolTraceInputSchema = SourceInputSchema.extend({
  command: z
    .string()
    .max(64 * 1024)
    .optional(),
  path: z.string().max(4_096).optional(),
  __micoPresentation: ChatToolTracePresentationSchema.optional()
}).transform(normalizeInput)

type ToolTraceInput = z.infer<typeof ToolTraceInputSchema>

function getWriteOperation(output: string | undefined): 'created' | 'replaced' | 'unknown' {
  if (output?.startsWith('Created ')) return 'created'
  if (output?.startsWith('Replaced ')) return 'replaced'
  return 'unknown'
}

function getToolTracePresentation(
  toolName: string,
  input: ToolTraceInput | undefined,
  output: string | undefined
): ChatToolTracePresentation | undefined {
  if (input?.__micoPresentation) return input.__micoPresentation
  if (!input) return undefined
  if ((toolName === 'Glob' || toolName === 'Grep') && output !== undefined)
    return { content: output, isTruncated: false, type: 'search' }
  if (['Read', 'LoadSkill', 'ReadSkillResource'].includes(toolName) && output !== undefined)
    return { content: output, isTruncated: false, type: 'read' }
  if (toolName === 'Bash' && (input.command || output !== undefined))
    return { content: output ?? '', isTruncated: false, type: 'bash' }
  if (toolName === 'Write' && input.content !== undefined)
    return {
      content: input.content,
      isTruncated: false,
      operation: getWriteOperation(output),
      type: 'write'
    }
  if (toolName === 'Edit' && input.edits)
    return { edits: input.edits, isTruncated: false, type: 'edit' }
  return undefined
}

export {
  getToolTracePresentation,
  getWriteOperation,
  type ToolTraceInput,
  ToolTraceInputSchema,
  ToolTraceSourceInputSchema
}
