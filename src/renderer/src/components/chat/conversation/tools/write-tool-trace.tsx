import * as React from 'react'

import { CheckIcon, FilePlus2Icon, FilePenLineIcon } from 'lucide-react'

function WriteToolTrace({
  content,
  isTruncated,
  operation,
  isDraft = false,
  path
}: {
  content: string
  isTruncated: boolean
  operation: 'created' | 'replaced' | 'unknown'
  /** Content received while the model is preparing the call is not committed yet. */
  isDraft?: boolean
  path?: string
}): React.JSX.Element {
  const lineCount = content.split('\n').length
  const byteCount = new TextEncoder().encode(content).byteLength
  const label = isDraft
    ? 'Preparing file'
    : operation === 'created'
      ? 'File created'
      : operation === 'replaced'
        ? 'File replaced'
        : 'File written'
  const Icon = operation === 'created' ? FilePlus2Icon : FilePenLineIcon

  return (
    <div
      aria-busy={isDraft}
      className="overflow-hidden rounded-lg border border-border-subtle bg-surface-secondary"
      data-state={isDraft ? 'draft' : 'complete'}
    >
      <div className="flex min-w-0 items-center gap-2 border-b border-border-subtle px-2.5 py-1.5 text-[11px]">
        <Icon aria-hidden="true" className="size-3.5 shrink-0 text-text-tertiary" />
        <span className="shrink-0 font-medium text-foreground">{label}</span>
        <span className="min-w-0 truncate font-mono text-text-tertiary">
          {path ?? 'File content'}
        </span>
        {!isDraft ? (
          <CheckIcon aria-hidden="true" className="ml-auto size-3 shrink-0 text-primary" />
        ) : null}
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

export { WriteToolTrace }
