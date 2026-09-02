import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { IconSwap } from '../../../components/composites/icon-swap'

describe('IconSwap', () => {
  it('keeps both icons mounted while switching the visible state', () => {
    const { rerender } = render(
      <IconSwap
        from={<svg data-testid="from-icon" />}
        state="from"
        to={<svg data-testid="to-icon" />}
      />
    )

    expect(screen.getByTestId('from-icon')).toBeInTheDocument()
    expect(screen.getByTestId('to-icon')).toBeInTheDocument()
    expect(screen.getByTestId('from-icon').closest('[data-slot="icon-swap"]')).toHaveAttribute(
      'data-state',
      'from'
    )

    rerender(
      <IconSwap
        from={<svg data-testid="from-icon" />}
        state="to"
        to={<svg data-testid="to-icon" />}
      />
    )

    expect(screen.getByTestId('from-icon')).toBeInTheDocument()
    expect(screen.getByTestId('to-icon')).toBeInTheDocument()
    expect(screen.getByTestId('from-icon').closest('[data-slot="icon-swap"]')).toHaveAttribute(
      'data-state',
      'to'
    )
  })
})
