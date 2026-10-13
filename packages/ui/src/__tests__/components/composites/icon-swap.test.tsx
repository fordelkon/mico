import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { IconSwap } from '../../../components/composites/icon-swap'

function iconSwap(state: 'from' | 'to') {
  return (
    <IconSwap
      from={<svg data-testid="from-icon" />}
      state={state}
      to={<svg data-testid="to-icon" />}
    />
  )
}

describe('IconSwap', () => {
  it('user switches the state when swapping icons, then both decorative icons stay mounted', () => {
    const { rerender } = render(iconSwap('from'))
    const fromIcon = screen.getByTestId('from-icon')
    const toIcon = screen.getByTestId('to-icon')

    expect(fromIcon).toBeInTheDocument()
    expect(toIcon).toBeInTheDocument()
    expect(fromIcon.closest('[data-slot="icon-swap"]')).toHaveAttribute('aria-hidden', 'true')

    rerender(iconSwap('to'))

    expect(screen.getByTestId('from-icon')).toBe(fromIcon)
    expect(screen.getByTestId('to-icon')).toBe(toIcon)
    expect(fromIcon.closest('[data-slot="icon-swap"]')).toHaveAttribute('aria-hidden', 'true')
  })
})
