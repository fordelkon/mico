import { Button } from '@mico/ui'
import { CheckIcon, CopyIcon } from 'lucide-react'
import * as React from 'react'

import { splitStableCode } from '../stream/streaming-code-highlighter'
import { useStreamingCodeHighlight } from '../stream/use-streaming-code-highlight'
import { ChatCodeLine } from './chat-code-line'

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

function ChatCodeBlock({ code, isStreaming, language }: ChatCodeBlockProps): React.JSX.Element {
  const [copied, setCopied] = React.useState(false)
  const lines = React.useMemo(() => code.split('\n'), [code])
  const { isFallback, source, tokenLines } = useStreamingCodeHighlight({
    code,
    isStreaming,
    language
  })
  const canRenderTokens = hasCompatibleHighlight({ isFallback, source }, code, language)
  const visibleRawTail = canRenderTokens ? splitStableCode(code, isStreaming).tail : ''
  const rawTailLines = React.useMemo(() => visibleRawTail.split('\n'), [visibleRawTail])
  const stableLineCount = visibleRawTail ? lines.length - rawTailLines.length : 0

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
          const rawLine =
            canRenderTokens && visibleRawTail && index >= stableLineCount
              ? rawTailLines[index - stableLineCount]
              : line

          return (
            <ChatCodeLine
              canRenderTokens={canRenderTokens}
              key={index}
              line={line}
              lineNumber={index + 1}
              rawLine={rawLine}
              tokens={tokenLines?.[index]}
            />
          )
        })}
      </pre>
    </div>
  )
}

export { ChatCodeBlock }
