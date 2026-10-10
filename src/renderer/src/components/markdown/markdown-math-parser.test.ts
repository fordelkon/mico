import katex from 'katex'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderMarkdownMath } from './markdown-math-parser'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('renderMarkdownMath', () => {
  it('user repeats formulas when the cache fills, then recent renders are reused and stale ones are recomputed', () => {
    // Observe calls to the real renderer: equal HTML alone cannot prove work was avoided.
    const renderToString = vi.spyOn(katex, 'renderToString')

    for (let index = 0; index < 129; index += 1) {
      renderMarkdownMath(`x_{bounded-cache-${index}}`, false)
    }

    renderToString.mockClear()
    renderMarkdownMath('x_{bounded-cache-128}', false)
    expect(renderToString).not.toHaveBeenCalled()

    // One more formula overflows the cache and drops the least recent one (bounded-cache-1).
    renderMarkdownMath('x_{bounded-cache-129}', false)
    renderToString.mockClear()

    renderMarkdownMath('x_{bounded-cache-1}', false)

    expect(renderToString).toHaveBeenCalledTimes(1)

    renderMarkdownMath('x_{bounded-cache-128}', false)

    // The recent formula was still cached, so no re-render was added for it.
    expect(renderToString).toHaveBeenCalledTimes(1)
  })
})
