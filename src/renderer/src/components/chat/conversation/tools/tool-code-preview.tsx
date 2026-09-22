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
    <div
      aria-label={label}
      aria-live={isStreaming ? 'polite' : 'off'}
      className="overflow-hidden rounded-md border border-border-subtle bg-surface-secondary"
      role="log"
    >
      <ChatCodeBlock
        code={content}
        isStreaming={isStreaming}
        language={language}
        outputLabel={label}
      />
    </div>
  )
}

export { ToolCodePreview }
