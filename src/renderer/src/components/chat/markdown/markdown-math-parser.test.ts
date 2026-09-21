import katex from 'katex'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderMarkdownMath } from './markdown-math-parser'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('renderMarkdownMath', () => {
  it('user sees the same rendered math when a formula repeats, then re-rendering is skipped', () => {
    const first = renderMarkdownMath('x_{render-cache-test}^2', false)
    const second = renderMarkdownMath('x_{render-cache-test}^2', false)

    expect(second).toBe(first)
  })

  it('user waits for a stale formula again when the cache is full, then a recent one stays instant', () => {
    // SAFETY: jsdom cannot render real KaTeX output; the spy's call count is the cache's observable seam.
    const renderToString = vi.spyOn(katex, 'renderToString')

    for (let index = 0; index < 129; index += 1) {
      renderMarkdownMath(`x_{bounded-cache-${index}}`, false)
    }

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
