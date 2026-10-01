import * as React from 'react'

import { ChatCodeBlock } from '../../markdown/chat-code-block'

function getToolCodeLanguage(path?: string): string {
  const extension = path?.split('/').at(-1)?.split('.').at(-1)?.toLowerCase()
  if (!extension) return 'text'
  return (
    {
      cjs: 'js',
      cts: 'ts',
      mjs: 'js',
      mts: 'ts',
      yml: 'yaml',
      zsh: 'bash'
    }[extension] ?? extension
  )
}

function ToolCodePreview({
  content,
  isStreaming = false,
  language = 'text',
  label,
  showLineNumbers = true
}: {
  content: string
  isStreaming?: boolean
  language?: string
  label: string
  showLineNumbers?: boolean
}): React.JSX.Element {
  return (
    <div
      aria-label={label}
      aria-live="off"
      className="tool-trace__content tool-trace__detail overflow-auto"
      role="log"
    >
      <ChatCodeBlock
        code={content}
        isStreaming={isStreaming}
        language={language}
        outputLabel={label}
        showLineNumbers={showLineNumbers}
      />
    </div>
  )
}

export { getToolCodeLanguage, ToolCodePreview }
