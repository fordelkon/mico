import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThinkingBlock } from './thinking-block'

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ThinkingBlock', () => {
  it('exposes a labeled, expanded disclosure while reasoning streams', () => {
    render(<ThinkingBlock id="reasoning-1" isStreaming text="" />)

    expect(screen.getByRole('button', { name: 'Thinking' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('lets people reveal a completed thought summary', () => {
    render(<ThinkingBlock id="reasoning-1" isStreaming={false} text="Inspecting the request." />)

    const button = screen.getByRole('button', { name: 'Thought summary' })
    const summary = screen.getByText('Inspecting the request.')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(summary).toHaveAttribute('aria-hidden', 'true')

    fireEvent.click(button)

    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(summary).toHaveAttribute('aria-hidden', 'false')
  })

  it('follows streamed reasoning without starting a smooth scroll animation', () => {
    const scrollTo = vi.fn()
    const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollTo
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      callback(performance.now())
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', (): void => undefined)

    try {
      render(<ThinkingBlock id="reasoning-1" isStreaming text="Inspecting the request." />)

      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
    } finally {
      if (originalScrollTo)
        Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
    }
  })
})
