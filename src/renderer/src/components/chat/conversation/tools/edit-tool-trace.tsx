import { CheckIcon, FileCode2Icon } from 'lucide-react'
import * as React from 'react'
import { editPreview } from './edit-preview'

type EditTrace = { newText: string; oldText: string }

/**
 * The edit tool only receives changed ranges, not source line numbers. Presenting
 * those ranges as a diff keeps that uncertainty honest while retaining +/- context.
 */
function EditToolTrace({
  edits,
  isTruncated,
  isStreaming = false,
  isPreparing = false,
  isDraft = false
}: {
  edits: EditTrace[]
  isTruncated: boolean
  /** An edit remains a proposal until the tool produces a successful result. */
  isDraft?: boolean
  isStreaming?: boolean
  isPreparing?: boolean
}): React.JSX.Element {
  if (!edits.length)
    return <p className="text-xs text-text-tertiary">Diff preview is too large to retain.</p>

  const previews = edits.map(editPreview)
  const additions = previews.reduce((count, edit) => count + edit.added.length, 0)
  const deletions = previews.reduce((count, edit) => count + edit.removed.length, 0)
  const stateLabel = isDraft
    ? isPreparing
      ? 'Preparing changes'
      : isStreaming
        ? 'Applying changes'
        : 'Changes not confirmed'
    : 'Changes applied'

  return (
    <div
      aria-busy={isStreaming}
      className="overflow-hidden rounded-lg border border-border-subtle bg-surface-secondary"
      data-state={isStreaming ? 'streaming' : isDraft ? 'draft' : 'complete'}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border-subtle px-2.5 py-1.5 text-[11px]">
        <FileCode2Icon aria-hidden="true" className="size-3.5 shrink-0 text-text-tertiary" />
        <span className="shrink-0 font-medium text-foreground">File changes</span>
        <span className="ml-auto flex shrink-0 items-center gap-2 font-mono tabular-nums">
          <span className="text-[var(--chat-diff-added)]">+{additions}</span>
          <span className="text-destructive">-{deletions}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-text-tertiary">
          {!isDraft ? <CheckIcon aria-hidden="true" className="size-3 text-primary" /> : null}
          {stateLabel}
        </span>
      </div>
      <div
        aria-label="File diff"
        aria-live="off"
        className="tool-trace__content overflow-auto"
        role="log"
        tabIndex={0}
      >
        {previews.map((edit, index) => (
          <div className="border-b border-border-subtle last:border-b-0" key={index}>
            <div className="px-2.5 py-1 text-[11px] text-text-tertiary">
              {isDraft ? 'Proposed change' : 'Applied change'} {index + 1}
            </div>
            <pre className="tool-trace__diff m-0 min-w-max font-mono text-xs leading-5 text-foreground">
              <DiffLines lines={edit.contextBefore} kind="context" />
              <DiffLines lines={edit.removed} kind="removed" />
              <DiffLines lines={edit.added} kind="added" />
              <DiffLines lines={edit.contextAfter} kind="context" />
            </pre>
          </div>
        ))}
      </div>
      {isTruncated ? (
        <p className="border-t border-border-subtle px-2.5 py-1.5 text-xs text-text-tertiary">
          Diff preview was omitted because it is too large.
        </p>
      ) : null}
    </div>
  )
}

function DiffLines({
  lines,
  kind
}: {
  lines: string[]
  kind: 'context' | 'added' | 'removed'
}): React.JSX.Element {
  return (
    <>
      {lines.map((line, index) => (
        <span className="tool-trace__diff-line" data-kind={kind} key={index}>
          <span className="tool-trace__diff-marker">
            {kind === 'added' ? '+' : kind === 'removed' ? '-' : ' '}
          </span>
          <span>{line || ' '}</span>
        </span>
      ))}
    </>
  )
}

export { EditToolTrace }
