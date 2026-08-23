import '@testing-library/jest-dom/vitest'

import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IconTooltipButton } from './icon-tooltip-button'

afterEach(() => {
  vi.useRealTimers()
})

describe('IconTooltipButton', () => {
  it('renders an accessible icon button with the expected defaults and forwards button props', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    render(
      <IconTooltipButton
        className="custom-class"
        icon={<svg data-testid="custom-icon" />}
        label="Add item"
        onClick={onClick}
      />
    )

    const button = screen.getByRole('button', { name: 'Add item' })
    await user.click(button)

    expect(button).toHaveAttribute('data-variant', 'ghost')
    expect(button).toHaveAttribute('data-size', 'icon')
    expect(button).toHaveClass('custom-class')
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('shows the label as tooltip content after a 500ms hover delay', async () => {
    vi.useFakeTimers()

    render(<IconTooltipButton icon={<svg />} label="Add item" />)
    fireEvent.pointerMove(screen.getByRole('button', { name: 'Add item' }))

    await act(() => vi.advanceTimersByTime(499))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Add item')
  })

  it('uses custom tooltip content', () => {
    render(
      <IconTooltipButton
        icon={<svg />}
        label="Add item"
        tooltip={<span>Creates a new item</span>}
      />
    )

    fireEvent.focus(screen.getByRole('button', { name: 'Add item' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Creates a new item')
  })

  it('forwards icon sizes and disabled state', () => {
    render(<IconTooltipButton disabled icon={<svg />} label="Add item" size="icon-lg" />)

    const button = screen.getByRole('button', { name: 'Add item' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('data-size', 'icon-lg')
  })
})
