import * as React from 'react'

import { ChatCodeBlock } from '../../../markdown/chat-code-block'
import { useTraceScroll } from './use-trace-scroll'

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
  const { contentRef, viewportRef, onScroll } = useTraceScroll(isDraft && isStreaming)
  return (
    <div
      aria-busy={isStreaming}
      className="tool-trace__detail overflow-hidden"
      data-state={isDraft ? 'draft' : 'complete'}
    >
      <div
        className="tool-trace__content overflow-auto"
        ref={viewportRef}
        onScroll={onScroll}
        tabIndex={0}
        aria-label="File preview"
        role="region"
      >
        <div ref={contentRef}>
          <ChatCodeBlock
            code={content}
            isStreaming={isStreaming}
            language={language}
            outputLabel={isDraft ? 'Proposed file content' : 'File preview'}
          />
        </div>
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
