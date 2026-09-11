import katex from 'katex'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderMarkdownMath } from './markdown-math-parser'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('renderMarkdownMath', () => {
  it('reuses rendered HTML for an unchanged formula', () => {
    const renderToString = vi.spyOn(katex, 'renderToString')

    const first = renderMarkdownMath('x_{render-cache-test}^2', false)
    const second = renderMarkdownMath('x_{render-cache-test}^2', false)

    expect(second).toBe(first)
    expect(renderToString).toHaveBeenCalledOnce()
  })

  it('evicts the least recently used formula when the cache reaches its bound', () => {
    const renderToString = vi.spyOn(katex, 'renderToString')

    for (let index = 0; index < 129; index += 1) {
      renderMarkdownMath(`x_{bounded-cache-${index}}`, false)
    }
    renderMarkdownMath('x_{bounded-cache-0}', false)
    renderMarkdownMath('x_{bounded-cache-128}', false)

    expect(renderToString).toHaveBeenCalledTimes(130)
  })
})
