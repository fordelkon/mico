import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BashToolTrace } from './bash-tool-trace'

describe('Terminal output following', () => {
  it('user expands terminal output when it contains formatting controls, then sees clean text', () => {
    render(
      <BashToolTrace
        output={'\u001b[31merror\u001b(B\u001b[0m\nplain text'}
        stderr={'\u001b[33mwarning\u001b[0m'}
        isTruncated={false}
      />
    )

    const viewport = screen.getByRole('log', { name: 'Terminal output' })
    expect(viewport).toHaveTextContent('errorplain text')
    expect(viewport).toHaveTextContent('warning')
    expect(viewport).not.toHaveTextContent('\u001b')
    expect(viewport).not.toHaveTextContent('(B')
  })

  it('user opens output when an OSC sequence never terminates, then earlier readable text remains responsive', () => {
    render(
      <BashToolTrace
        output={`readable output\n${'\u001b]8;;'.repeat(20_000)}`}
        isTruncated={false}
      />
    )

    const viewport = screen.getByRole('log', { name: 'Terminal output' })
    expect(viewport).toHaveTextContent('readable output')
    expect(viewport).not.toHaveTextContent('8;;')
  })

  it('user reads earlier output when more text arrives, then their position is preserved until returning to the bottom', () => {
    const { rerender } = render(
      <BashToolTrace isStreaming output="First output" isTruncated={false} />
    )
    const viewport = screen.getByRole('log', { name: 'Terminal output' })
    // jsdom has no layout; provide viewport geometry at the browser boundary.
    let height = 500
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, get: () => height }
    })
    rerender(<BashToolTrace isStreaming output="Second output" isTruncated={false} />)
    expect(viewport.scrollTop).toBe(400)
    viewport.scrollTop = 100
    fireEvent.scroll(viewport)
    height = 600
    rerender(<BashToolTrace isStreaming output="Third output" isTruncated={false} />)
    expect(viewport.scrollTop).toBe(100)
    viewport.scrollTop = 500
    fireEvent.scroll(viewport)
    height = 700
    rerender(<BashToolTrace output="Final output" isTruncated={false} />)
    expect(viewport.scrollTop).toBe(600)
  })
})
