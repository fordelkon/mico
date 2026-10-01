import * as React from 'react'

import { ChatCodeBlock } from '../../markdown/chat-code-block'
import { stripTerminalControlSequences } from './terminal-output'

function BashToolTrace({
  isStreaming = false,
  output,
  stderr,
  isTruncated
}: {
  isStreaming?: boolean
  output: string
  stderr?: string
  isTruncated: boolean
}): React.JSX.Element {
  const cleanOutput = stripTerminalControlSequences(output)
  const cleanStderr = stderr ? stripTerminalControlSequences(stderr) : undefined
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const followOutput = React.useRef(true)
  const follow = React.useCallback(() => {
    const viewport = viewportRef.current
    if (viewport && viewport.clientHeight > 0 && followOutput.current) {
      viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    }
  }, [])

  React.useLayoutEffect(follow, [follow, cleanOutput, cleanStderr])
  React.useLayoutEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return
    // Observe both disclosure resizing and asynchronous syntax highlighting.
    const observer = new ResizeObserver(follow)
    observer.observe(viewport)
    observer.observe(content)
    return () => observer.disconnect()
  }, [follow])

  return (
    <div aria-busy={isStreaming} className="tool-trace__detail overflow-hidden">
      <div
        aria-label="Terminal output"
        aria-live="off"
        className="agent-activity__terminal-viewport"
        ref={viewportRef}
        tabIndex={0}
        onScroll={(event) => {
          const viewport = event.currentTarget
          if (viewport.clientHeight > 0) {
            followOutput.current =
              viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 4
          }
        }}
        role="log"
      >
        <div ref={contentRef}>
          <div className="border-b border-border-subtle last:border-b-0">
            <ChatCodeBlock
              code={cleanOutput || (isStreaming ? 'Waiting for output…' : 'No output.')}
              isStreaming={isStreaming}
              language="text"
              outputLabel="Output"
              showLineNumbers={false}
            />
          </div>
          {cleanStderr ? (
            <div className="bg-surface-secondary">
              <ChatCodeBlock
                code={cleanStderr}
                isStreaming={isStreaming}
                language="text"
                outputLabel="Standard error"
                showLineNumbers={false}
              />
            </div>
          ) : null}
        </div>
      </div>
      {isTruncated ? (
        <p className="px-2.5 py-1.5 text-xs text-text-tertiary">Output truncated.</p>
      ) : null}
    </div>
  )
}

export { BashToolTrace }
