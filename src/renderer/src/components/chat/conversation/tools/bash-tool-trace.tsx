import * as React from 'react'

import { ChatCodeBlock } from '../../../markdown/chat-code-block'
import { stripTerminalControlSequences } from './terminal-output'
import { useTraceScroll } from './use-trace-scroll'

function BashToolTrace({
  command,
  isStreaming = false,
  output,
  stderr,
  isTruncated
}: {
  command?: string
  isStreaming?: boolean
  output: string
  stderr?: string
  isTruncated: boolean
}): React.JSX.Element {
  const cleanOutput = stripTerminalControlSequences(output)
  const cleanStderr = stderr ? stripTerminalControlSequences(stderr) : undefined
  const { contentRef, viewportRef, onScroll } = useTraceScroll(true)

  return (
    <div aria-busy={isStreaming} className="tool-trace__detail overflow-hidden">
      {command ? (
        <pre aria-label="Command" className="tool-trace__command font-mono">
          {command}
        </pre>
      ) : null}
      <div
        aria-label="Terminal output"
        aria-live="off"
        className="agent-activity__terminal-viewport"
        ref={viewportRef}
        tabIndex={0}
        onScroll={onScroll}
        role="log"
      >
        <div ref={contentRef}>
          {cleanOutput ? (
            <div className="border-b border-border-subtle last:border-b-0">
              <ChatCodeBlock
                code={cleanOutput}
                isStreaming={isStreaming}
                language="text"
                outputLabel="Output"
                showLineNumbers={false}
              />
            </div>
          ) : (
            !cleanStderr && (
              <p className="px-3 py-2 text-xs text-text-secondary">
                {isStreaming ? 'Waiting for output…' : 'No output.'}
              </p>
            )
          )}
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
