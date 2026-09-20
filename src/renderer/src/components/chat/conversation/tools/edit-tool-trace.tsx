import { CheckIcon, FileCode2Icon, LoaderCircleIcon } from 'lucide-react'
import * as React from 'react'

type EditTrace = { newText: string; oldText: string }

function countLines(text: string): number {
  return text ? text.split('\n').length : 0
}

/**
 * The edit tool only receives changed ranges, not source line numbers. Presenting
 * those ranges as a diff keeps that uncertainty honest while retaining +/- context.
 */
function EditToolTrace({
  edits,
  isTruncated,
  isDraft = false
}: {
  edits: EditTrace[]
  isTruncated: boolean
  /** An edit remains a proposal until the tool produces a successful result. */
  isDraft?: boolean
}): React.JSX.Element {
  if (!edits.length)
    return <p className="text-xs text-text-tertiary">Diff preview is too large to retain.</p>

  const additions = edits.reduce((count, edit) => count + countLines(edit.newText), 0)
  const deletions = edits.reduce((count, edit) => count + countLines(edit.oldText), 0)
  const stateLabel = isDraft ? 'Applying changes' : 'Changes applied'

  return (
    <div
      aria-busy={isDraft}
      className="overflow-hidden rounded-lg border border-border-subtle bg-surface-secondary"
      data-state={isDraft ? 'streaming' : 'complete'}
    >
      <div className="flex min-w-0 items-center gap-2 border-b border-border-subtle px-2.5 py-1.5 text-[11px]">
        <FileCode2Icon aria-hidden="true" className="size-3.5 shrink-0 text-text-tertiary" />
        <span className="shrink-0 font-medium text-foreground">File changes</span>
        <span className="ml-auto flex shrink-0 items-center gap-2 font-mono tabular-nums">
          <span className="text-primary">+{additions}</span>
          <span className="text-destructive">-{deletions}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-text-tertiary">
          {isDraft ? (
            <LoaderCircleIcon aria-hidden="true" className="size-3 animate-spin" />
          ) : (
            <CheckIcon aria-hidden="true" className="size-3 text-primary" />
          )}
          {stateLabel}
        </span>
      </div>
      <div
        aria-label="File diff"
        aria-live={isDraft ? 'polite' : 'off'}
        className="overflow-visible"
        role="log"
      >
        {edits.map((edit, index) => (
          <div className="border-b border-border-subtle last:border-b-0" key={index}>
            <div className="px-2.5 py-1 text-[11px] text-text-tertiary">
              {isDraft ? 'Proposed change' : 'Applied change'} {index + 1}
            </div>
            <pre className="bg-destructive/10 px-2.5 py-1.5 font-mono text-xs leading-5 whitespace-pre-wrap break-words text-foreground">
              <span aria-hidden="true" className="select-none text-destructive">
                -
              </span>
              {edit.oldText}
            </pre>
            <pre className="bg-primary/10 px-2.5 py-1.5 font-mono text-xs leading-5 whitespace-pre-wrap break-words text-foreground">
              <span aria-hidden="true" className="select-none text-primary">
                +
              </span>
              {edit.newText}
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

export { EditToolTrace }
