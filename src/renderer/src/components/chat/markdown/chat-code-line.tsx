import type { ThemedToken } from 'shiki'
import * as React from 'react'

type ChatCodeLineProps = {
  canRenderTokens: boolean
  line: string
  lineNumber: number
  rawLine: string
  tokens: readonly ThemedToken[] | undefined
}

function completeTokensForLine(
  line: string,
  tokens: readonly ThemedToken[] | undefined,
  canRenderTokens: boolean
): readonly ThemedToken[] | null {
  if (!canRenderTokens || !tokens?.length) return null
  return tokens.map((token) => token.content).join('') === line ? tokens : null
}

function ChatCodeLineComponent({
  canRenderTokens,
  line,
  lineNumber,
  rawLine,
  tokens: candidateTokens
}: ChatCodeLineProps): React.JSX.Element {
  const tokens = completeTokensForLine(line, candidateTokens, canRenderTokens)

  return (
    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)]">
      <span className="chat-code-block__gutter select-none pr-3 text-right">{lineNumber}</span>
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
}

const ChatCodeLine = React.memo(ChatCodeLineComponent)

export { ChatCodeLine }
