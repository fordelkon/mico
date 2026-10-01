import * as React from 'react'
import type { ThemedToken } from 'shiki'
import { useStreamingCodeHighlight } from '../../markdown/use-streaming-code-highlight'
import { editPreview } from './edit-preview'

type EditTrace = { newText: string; oldText: string }

/**
 * The edit tool only receives changed ranges, not source line numbers. Presenting
 * those ranges as a diff keeps that uncertainty honest while retaining +/- context.
 */
function EditToolTrace({
  edits,
  isTruncated,
  language,
  isStreaming = false,
  isDraft = false
}: {
  edits: EditTrace[]
  isTruncated: boolean
  language: string
  /** An edit remains a proposal until the tool produces a successful result. */
  isDraft?: boolean
  isStreaming?: boolean
}): React.JSX.Element {
  if (!edits.length)
    return <p className="text-xs text-text-tertiary">Diff preview is too large to retain.</p>

  const previews = edits.map(editPreview)
  return (
    <div
      aria-busy={isStreaming}
      className="tool-trace__detail overflow-hidden"
      data-state={isStreaming ? 'streaming' : isDraft ? 'draft' : 'complete'}
    >
      <div
        aria-label="File diff"
        aria-live="off"
        className="tool-trace__content overflow-auto"
        role="log"
        tabIndex={0}
      >
        {previews.map((edit, index) => (
          <DiffPreview
            edit={edit}
            index={index}
            isDraft={isDraft}
            key={index}
            language={language}
          />
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

function DiffPreview({
  edit,
  index,
  isDraft,
  language
}: {
  edit: ReturnType<typeof editPreview>
  index: number
  isDraft: boolean
  language: string
}): React.JSX.Element {
  const lines = [
    ...edit.contextBefore.map((text) => ({ kind: 'context' as const, text })),
    ...edit.removed.map((text) => ({ kind: 'removed' as const, text })),
    ...edit.added.map((text) => ({ kind: 'added' as const, text })),
    ...edit.contextAfter.map((text) => ({ kind: 'context' as const, text }))
  ]
  const code = lines.map(({ text }) => text).join('\n')
  const { isFallback, source, tokenLines } = useStreamingCodeHighlight({
    code,
    isStreaming: false,
    language
  })
  const highlighted = !isFallback && source.code === code && source.language === language

  return (
    <div className="border-b border-border-subtle last:border-b-0">
      <div className="px-2.5 py-1 text-[11px] text-text-tertiary">
        {isDraft ? 'Proposed change' : 'Applied change'} {index + 1}
      </div>
      <pre className="tool-trace__diff m-0 min-w-max font-mono text-xs leading-5 text-foreground">
        {lines.map(({ kind, text }, lineIndex) => (
          <DiffLine
            kind={kind}
            key={`${lineIndex}-${kind}`}
            text={text}
            tokens={highlighted ? tokenLines?.[lineIndex] : undefined}
          />
        ))}
      </pre>
    </div>
  )
}

function DiffLine({
  text,
  kind,
  tokens
}: {
  text: string
  kind: 'context' | 'added' | 'removed'
  tokens?: ThemedToken[]
}): React.JSX.Element {
  const completeTokens =
    tokens?.map((token) => token.content).join('') === text ? tokens : undefined
  return (
    <span className="tool-trace__diff-line" data-kind={kind}>
      <span className="tool-trace__diff-marker">
        {kind === 'added' ? '+' : kind === 'removed' ? '-' : ' '}
      </span>
      <span>
        {completeTokens?.length
          ? completeTokens.map((token, index) => (
              <span
                className="text-[var(--shiki-light)] dark:text-[var(--shiki-dark)]"
                data-code-token
                key={`${index}-${token.content}`}
                style={token.htmlStyle}
              >
                {token.content}
              </span>
            ))
          : text || ' '}
      </span>
    </span>
  )
}

export { EditToolTrace }
