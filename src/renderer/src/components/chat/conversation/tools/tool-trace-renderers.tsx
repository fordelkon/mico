import * as React from 'react'
import * as z from 'zod'
import { ChatToolTracePresentationSchema } from '@shared/data/schemas/chat'

import { BashToolTrace } from './bash-tool-trace'
import { EditToolTrace } from './edit-tool-trace'
import { WriteToolTrace } from './write-tool-trace'
import { ToolCodePreview } from './tool-code-preview'
import { getToolCodeLanguage } from './tool-code-preview'

const ToolTraceInputSchema = z
  .object({
    query: z.string().optional(),
    mode: z.enum(['files', 'content']).optional(),
    glob: z.string().optional(),
    command: z
      .string()
      .max(64 * 1024)
      .optional(),
    content: z.string().optional(),
    file_path: z.string().optional(),
    pattern: z.string().optional(),
    old_string: z.string().optional(),
    new_string: z.string().optional(),
    path: z.string().max(4_096).optional(),
    __micoPresentation: ChatToolTracePresentationSchema.optional()
  })
  .transform((input) => ({
    ...input,
    path: input.file_path ?? input.path,
    query: input.pattern ?? input.query,
    edits:
      input.old_string !== undefined || input.new_string !== undefined
        ? [{ oldText: input.old_string ?? '', newText: input.new_string ?? '' }]
        : undefined
  }))
type ToolTraceInput = z.infer<typeof ToolTraceInputSchema>
type ToolTracePresentation = NonNullable<ToolTraceInput['__micoPresentation']>

function getToolTracePresentation(
  toolName: string,
  input: ToolTraceInput | undefined,
  output: string | undefined
): ToolTracePresentation | undefined {
  if (input?.__micoPresentation) return input.__micoPresentation
  if (!input) return undefined
  if ((toolName === 'Glob' || toolName === 'Grep') && output !== undefined)
    return { content: output, isTruncated: false, type: 'search' }
  if (toolName === 'Read' && output !== undefined)
    return { content: output, isTruncated: false, type: 'read' }
  if (toolName === 'Bash' && (input.command || output !== undefined))
    return { content: output ?? '', isTruncated: false, type: 'bash' }
  if (toolName === 'Write' && input.content !== undefined)
    return {
      content: input.content,
      isTruncated: false,
      operation: output?.startsWith('Created ')
        ? 'created'
        : output?.startsWith('Replaced ')
          ? 'replaced'
          : 'unknown',
      type: 'write'
    }
  if (toolName === 'Edit' && input.edits)
    return { edits: input.edits, isTruncated: false, type: 'edit' }
  return undefined
}

function searchDetails(content: string): string {
  const lines = content.split('\n')
  return /^(Found \d+|No matches found\.|No entries at this offset\.)/.test(lines[0] ?? '')
    ? lines.slice(1).join('\n')
    : content
}

function ToolTracePresentationView({
  isDraft = false,
  isStreaming = false,
  liveOutput,
  path,
  presentation
}: {
  isDraft?: boolean
  isStreaming?: boolean
  liveOutput?: { preview: string; stderr: string; stdout: string }
  path?: string
  presentation: ToolTracePresentation
}): React.JSX.Element {
  if (presentation.type === 'edit')
    return (
      <EditToolTrace
        edits={presentation.edits}
        isDraft={isDraft}
        isStreaming={isStreaming}
        isTruncated={presentation.isTruncated}
        language={getToolCodeLanguage(path)}
      />
    )
  if (presentation.type === 'bash')
    return (
      <BashToolTrace
        isStreaming={isStreaming}
        output={liveOutput ? liveOutput.stdout : presentation.content}
        stderr={liveOutput?.stderr}
        isTruncated={presentation.isTruncated}
      />
    )
  if (presentation.type === 'read')
    return (
      <ToolCodePreview
        content={presentation.content}
        label="File content"
        language={getToolCodeLanguage(path)}
      />
    )
  if (presentation.type === 'search')
    return (
      <ToolCodePreview
        content={searchDetails(presentation.content)}
        label="Search results"
        showLineNumbers={false}
      />
    )
  if (presentation.type === 'write')
    return (
      <WriteToolTrace
        content={liveOutput?.preview ?? presentation.content}
        isDraft={isDraft}
        isStreaming={isStreaming}
        isTruncated={presentation.isTruncated}
        language={getToolCodeLanguage(path)}
      />
    )
  return <></>
}

export {
  getToolTracePresentation,
  ToolTraceInputSchema,
  ToolTracePresentationView,
  type ToolTraceInput,
  type ToolTracePresentation
}
