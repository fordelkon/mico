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
  const hasError = Boolean(stderr)

  return (
    <div
      aria-busy={isStreaming}
      className="overflow-hidden rounded-lg border border-border-subtle bg-surface-secondary"
      data-state={isStreaming ? 'running' : hasError ? 'error' : 'success'}
    >
      <div className="flex min-w-0 items-center gap-2 border-b border-border-subtle px-2.5 py-1.5 text-[11px]">
        <SquareTerminalIcon aria-hidden="true" className="size-3.5 shrink-0 text-text-tertiary" />
        <span className="shrink-0 font-medium text-foreground">Command</span>
      </div>
      <div
        aria-label="Terminal output"
        aria-live={isStreaming ? 'polite' : 'off'}
        className="overflow-visible"
        role="log"
      >
        {command ? (
          <div className="border-b border-border-subtle px-2.5 py-1.5 font-mono text-xs text-text-secondary">
            <span aria-hidden="true" className="select-none text-text-tertiary">
              $
            </span>
            {command}
          </div>
        ) : null}
        <div className="border-b border-border-subtle last:border-b-0">
          <ChatCodeBlock
            code={output}
            isStreaming={isStreaming}
            language="text"
            outputLabel="Output"
          />
        </div>
        {stderr ? (
          <div className="bg-destructive/5">
            <ChatCodeBlock
              code={stderr}
              isStreaming={isStreaming}
              language="text"
              outputLabel="Standard error"
            />
          </div>
        ) : null}
      </div>
      {isTruncated ? (
        <p className="px-2.5 py-1.5 text-xs text-text-tertiary">Output truncated.</p>
      ) : null}
    </div>
  )
}

export { BashToolTrace }
