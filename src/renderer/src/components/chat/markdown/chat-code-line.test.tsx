import { render } from '@testing-library/react'
import type { ThemedToken } from 'shiki'
import { describe, expect, it } from 'vitest'

import { ChatCodeLine } from './chat-code-line'

describe('ChatCodeLine', () => {
  it('does not revalidate unchanged highlighted tokens on a parent render', () => {
    let tokenReads = 0
    const token = {
      get content() {
        tokenReads += 1
        return 'const stable = true'
      },
      offset: 0,
      htmlStyle: {}
    } satisfies ThemedToken
    const tokens = [token]
    const { rerender } = render(
      <ChatCodeLine
        canRenderTokens
        line="const stable = true"
        lineNumber={1}
        rawLine="const stable = true"
        tokens={tokens}
      />
    )
    const readsAfterInitialRender = tokenReads

    rerender(
      <ChatCodeLine
        canRenderTokens
        line="const stable = true"
        lineNumber={1}
        rawLine="const stable = true"
        tokens={tokens}
      />
    )

    expect(tokenReads).toBe(readsAfterInitialRender)
  })
})
