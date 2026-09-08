import { Button } from '@mico/ui'
import { CheckIcon, CopyIcon } from 'lucide-react'
import * as React from 'react'

import { useStreamingCodeHighlight } from './use-streaming-code-highlight'

type ChatCodeBlockProps = {
  code: string
  isStreaming: boolean
  language?: string
}

type HighlightIdentity = {
  isFallback: boolean
  source: { code: string; language?: string }
}

function hasCompatibleHighlight(
  highlight: HighlightIdentity,
  code: string,
  language?: string
): boolean {
  // Keep completed lines highlighted while an append-only stream waits for its next Shiki update.
  return (
    !highlight.isFallback &&
    highlight.source.language === language &&
    code.startsWith(highlight.source.code)
  )
}

function completeTokensForLine<Token extends { content: string }>(
  line: string,
  tokens: readonly Token[] | undefined,
  canRenderTokens: boolean
): readonly Token[] | null {
  if (!canRenderTokens || !tokens?.length) return null
  return tokens.map((token) => token.content).join('') === line ? tokens : null
}

function ChatCodeBlock({ code, isStreaming, language }: ChatCodeBlockProps): React.JSX.Element {
  const [copied, setCopied] = React.useState(false)
  const lines = code.split('\n')
  const { isFallback, rawTail, source, tokenLines } = useStreamingCodeHighlight({
    code,
    isStreaming,
    language
  })
  const canRenderTokens = hasCompatibleHighlight({ isFallback, source }, code, language)
  const visibleRawTail = canRenderTokens ? rawTail : ''
  const stableLineCount =
    visibleRawTail && code.endsWith(visibleRawTail)
      ? code.slice(0, -visibleRawTail.length).replace(/\n$/, '').split('\n').length
      : 0
  const rawTailLines = visibleRawTail.split('\n')

  React.useEffect(() => {
    if (!copied) return

    const timeoutId = window.setTimeout(() => setCopied(false), 1_500)
    return () => window.clearTimeout(timeoutId)
  }, [copied])

  const copy = (): void => {
    void navigator.clipboard.writeText(code).then(
      () => setCopied(true),
      () => setCopied(false)
    )
  }

  return (
    <div
      className="chat-code-block my-4 overflow-hidden rounded-lg border font-mono text-sm"
      data-testid="code-block"
    >
      <div className="chat-code-block__header flex h-10 items-center px-3 text-xs">
        <span>{language ?? 'text'}</span>
        <Button aria-label="Copy code" className="ml-auto" onClick={copy} size="xs" variant="ghost">
          {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="chat-code-block__body overflow-x-auto py-3">
        {lines.map((line, index) => {
          const tokens = completeTokensForLine(line, tokenLines?.[index], canRenderTokens)
          const rawLine =
            canRenderTokens && visibleRawTail && index >= stableLineCount
              ? rawTailLines[index - stableLineCount]
              : line

          return (
            <div className="grid grid-cols-[2.5rem_minmax(0,1fr)]" key={index}>
              <span className="chat-code-block__gutter select-none pr-3 text-right">
                {index + 1}
              </span>
              <code className="min-w-0 px-3 whitespace-pre">
                {tokens
                  ? tokens.map((token, tokenIndex) => (
                      <span data-code-token key={tokenIndex} style={token.htmlStyle}>
                        {token.content}
                      </span>
                    ))
                  : rawLine || ' '}
              </code>
            </div>
          )
        })}
      </pre>
    </div>
  )
}

export { ChatCodeBlock }
