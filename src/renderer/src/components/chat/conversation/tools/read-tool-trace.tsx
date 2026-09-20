import * as React from 'react'

import { CheckIcon, FileSearchIcon } from 'lucide-react'

function ReadToolTrace({
  content,
  isTruncated,
  path
}: {
  content: string
  isTruncated: boolean
  path?: string
}): React.JSX.Element {
  const lineCount = content.split('\n').length
  const byteCount = new TextEncoder().encode(content).byteLength

  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-secondary">
      <div className="flex min-w-0 items-center gap-2 border-b border-border-subtle px-2.5 py-1.5 text-[11px]">
        <FileSearchIcon aria-hidden="true" className="size-3.5 shrink-0 text-text-tertiary" />
        <span className="shrink-0 font-medium text-foreground">File read</span>
        <span className="min-w-0 truncate font-mono text-text-tertiary">
          {path ?? 'File content'}
        </span>
        <CheckIcon aria-hidden="true" className="ml-auto size-3 shrink-0 text-primary" />
      </div>
      <div className="flex items-center gap-3 px-2.5 py-2 font-mono text-xs tabular-nums text-text-secondary">
        <span>
          {lineCount} {lineCount === 1 ? 'line' : 'lines'}
        </span>
        <span>{byteCount.toLocaleString('en-US')} bytes</span>
        {isTruncated ? <span className="text-text-tertiary">Preview truncated</span> : null}
      </div>
    </div>
  )
}

export { ReadToolTrace }
