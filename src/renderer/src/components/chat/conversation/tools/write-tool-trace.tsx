import * as React from 'react'

import { ChatCodeBlock } from '../../../markdown/chat-code-block'

function WriteToolTrace({
  content,
  isTruncated,
  language,
  isStreaming = false,
  isDraft = false
}: {
  content: string
  isTruncated: boolean
  language: string
  /** Content received while the model is preparing the call is not committed yet. */
  isDraft?: boolean
  isStreaming?: boolean
}): React.JSX.Element {
  return (
    <div
      aria-busy={isStreaming}
      className="tool-trace__detail overflow-hidden"
      data-state={isDraft ? 'draft' : 'complete'}
    >
      <div className="tool-trace__content overflow-auto">
        <ChatCodeBlock
          code={content}
          isStreaming={isStreaming}
          language={language}
          outputLabel="File preview"
        />
      </div>
      {isTruncated ? (
        <p className="border-t border-border-subtle px-2.5 py-1.5 text-xs text-text-tertiary">
          Preview truncated.
        </p>
      ) : null}
    </div>
  )
}

export { WriteToolTrace }
