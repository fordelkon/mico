import '@testing-library/jest-dom/vitest'

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThinkingBlock } from './thinking-block'

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ThinkingBlock', () => {
  it('keeps a collapsible panel mounted for the disclosure transition', () => {
    render(<ThinkingBlock id="reasoning-1" isStreaming={false} text="Inspecting the request." />)

    const button = screen.getByRole('button', { name: 'Thought summary' })
    const section = button.closest('section')

    expect(section).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('thinking-panel')).toBeInTheDocument()

    fireEvent.click(button)

    expect(section).toHaveAttribute('data-open', 'true')
  })

  it('uses one randomly selected orb state for an active thought', () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    render(<ThinkingBlock id="reasoning-1" isStreaming text="Inspecting the request." />)

    expect(screen.getByText('Thinking')).toHaveClass('thinking-block__label--active')
    expect(screen.getByTestId('thinking-orb')).toHaveAttribute('data-orb-state', 'searching')

    void act(() => vi.advanceTimersByTime(1_600))

    expect(screen.getByTestId('thinking-orb')).toHaveAttribute('data-orb-state', 'searching')
  })

  it('shows a thinking row before a summary arrives', () => {
    render(<ThinkingBlock id="reasoning-1" isStreaming text="" />)

    expect(screen.getByRole('button', { name: 'Thinking' })).toBeVisible()
  })

  it('shows an inline thinking orb while reasoning streams', () => {
    render(<ThinkingBlock id="reasoning-1" isStreaming text="Inspecting the request." />)

    expect(screen.getByTestId('thinking-orb')).toBeInTheDocument()
  })

  it('keeps a static thinking icon visible after streaming finishes', () => {
    render(<ThinkingBlock id="reasoning-1" isStreaming={false} text="Inspecting the request." />)

    expect(
      screen.getByRole('button', { name: 'Thought summary' }).querySelector('svg')
    ).toBeInTheDocument()
  })
})
