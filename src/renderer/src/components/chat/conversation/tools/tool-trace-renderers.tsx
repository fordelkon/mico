import * as React from 'react'
import type { ChatToolTracePresentation } from '@shared/data/schemas/chat'

import { BashToolTrace } from './bash-tool-trace'
import { EditToolTrace } from './edit-tool-trace'
import { WriteToolTrace } from './write-tool-trace'
import { ToolCodePreview } from './tool-code-preview'
import { getToolCodeLanguage } from './tool-code-preview'

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
  presentation: ChatToolTracePresentation
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

export { ToolTracePresentationView }
