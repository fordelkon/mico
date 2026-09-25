import * as React from 'react'
import * as z from 'zod'

import { BashToolTrace } from './bash-tool-trace'
import { EditToolTrace } from './edit-tool-trace'
import { ReadToolTrace } from './read-tool-trace'
import { WriteToolTrace } from './write-tool-trace'
import { ToolCodePreview } from './tool-code-preview'

const ToolTraceInputSchema = z.object({
  command: z
    .string()
    .max(64 * 1024)
    .optional(),
  content: z.string().optional(),
  edits: z.array(z.object({ newText: z.string(), oldText: z.string() })).optional(),
  path: z.string().max(4_096).optional(),
  __micoPresentation: z
    .discriminatedUnion('type', [
      z.object({ type: z.enum(['bash', 'read']), content: z.string(), isTruncated: z.boolean() }),
      z.object({
        type: z.literal('write'),
        content: z.string(),
        isTruncated: z.boolean(),
        operation: z.enum(['created', 'replaced', 'unknown'])
      }),
      z.object({
        type: z.literal('edit'),
        edits: z.array(z.object({ oldText: z.string(), newText: z.string() })),
        isTruncated: z.boolean()
      })
    ])
    .optional()
})
type ToolTraceInput = z.infer<typeof ToolTraceInputSchema>
type ToolTracePresentation = NonNullable<ToolTraceInput['__micoPresentation']>

function getToolTracePresentation(
  toolName: string,
  input: ToolTraceInput | undefined,
  output: string | undefined
): ToolTracePresentation | undefined {
  if (input?.__micoPresentation) return input.__micoPresentation
  if (!input) return undefined
  if (toolName === 'read' && output) return { content: output, isTruncated: false, type: 'read' }
  // Retain the complete command before output arrives, including failed calls
  // with no output. Live deltas can fill this terminal shell independently.
  if (toolName === 'bash' && (input.command || output !== undefined))
    return { content: output ?? '', isTruncated: false, type: 'bash' }
  if (toolName === 'write' && input.content !== undefined)
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
  if (toolName === 'edit' && input.edits)
    return { edits: input.edits, isTruncated: false, type: 'edit' }
  return undefined
}

function ToolTracePresentationView({
  command,
  isDraft = false,
  isStreaming = false,
  liveOutput,
  path,
  presentation
}: {
  command?: string
  isDraft?: boolean
  isStreaming?: boolean
  liveOutput?: { preview: string; stderr: string; stdout: string }
  path?: string
  presentation: ToolTracePresentation
}): React.JSX.Element {
  if (presentation.type === 'edit' && liveOutput?.preview)
    return (
      <ToolCodePreview
        content={liveOutput.preview}
        isStreaming={isStreaming}
        label="Diff preview"
      />
    )
  if (presentation.type === 'edit')
    return (
      <EditToolTrace
        edits={presentation.edits}
        isDraft={isDraft}
        isStreaming={isStreaming}
        isTruncated={presentation.isTruncated}
      />
    )
  if (presentation.type === 'bash')
    return (
      <BashToolTrace
        command={command}
        isStreaming={isStreaming}
        output={liveOutput ? liveOutput.stdout : presentation.content}
        stderr={liveOutput?.stderr}
        isTruncated={presentation.isTruncated}
      />
    )
  if (presentation.type === 'read')
    return (
      <ReadToolTrace
        content={liveOutput?.preview ?? presentation.content}
        isTruncated={presentation.isTruncated}
        path={path}
      />
    )
  if (presentation.type === 'write')
    return (
      <WriteToolTrace
        content={liveOutput?.preview ?? presentation.content}
        isDraft={isDraft}
        isStreaming={isStreaming}
        isTruncated={presentation.isTruncated}
        operation={presentation.operation}
        path={path}
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
