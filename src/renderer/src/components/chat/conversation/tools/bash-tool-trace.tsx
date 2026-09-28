import { SquareTerminalIcon } from 'lucide-react'
import * as React from 'react'

import { ChatCodeBlock } from '../../markdown/chat-code-block'

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
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const followOutput = React.useRef(true)
  const follow = React.useCallback(() => {
    const viewport = viewportRef.current
    if (viewport && viewport.clientHeight > 0 && followOutput.current) {
      viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    }
  }, [])

  React.useLayoutEffect(follow, [follow, output, stderr])
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
    <div
      aria-busy={isStreaming}
      className="overflow-hidden rounded-lg border border-border-subtle bg-surface-secondary"
    >
      <div className="flex min-w-0 items-center gap-2 border-b border-border-subtle px-2.5 py-1.5 text-[11px]">
        <SquareTerminalIcon aria-hidden="true" className="size-3.5 shrink-0 text-text-tertiary" />
        <span className="shrink-0 font-medium text-foreground">Command</span>
      </div>
      {command ? (
        <pre className="tool-trace__command m-0 max-h-32 overflow-auto border-b border-border-subtle px-3 py-2 font-mono text-xs leading-5 text-foreground">
          <span aria-hidden="true" className="select-none text-text-tertiary">
            ${' '}
          </span>
          {command}
        </pre>
      ) : null}
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
              code={output || (isStreaming ? 'Waiting for output…' : 'No output.')}
              isStreaming={isStreaming}
              language="text"
              outputLabel="Output"
            />
          </div>
          {stderr ? (
            <div className="bg-surface-secondary">
              <ChatCodeBlock
                code={stderr}
                isStreaming={isStreaming}
                language="text"
                outputLabel="Standard error"
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
