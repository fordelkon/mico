import * as React from 'react'

import { ChatCodeBlock } from '../../markdown/chat-code-block'

function ToolCodePreview({
  content,
  isStreaming = false,
  language = 'text',
  label
}: {
  content: string
  isStreaming?: boolean
  language?: string
  label: string
}): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-md border border-border-subtle bg-surface-secondary">
      <div className="border-b border-border-subtle px-2 py-1 text-[11px] font-medium text-text-tertiary">
        {label}
      </div>
      <ChatCodeBlock code={content} isStreaming={isStreaming} language={language} />
    </div>
  )
}

export { ToolCodePreview }
