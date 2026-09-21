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

// jsdom does not apply Tailwind's compiled stylesheet, so the visibility rules IconSwap
// relies on are injected here; only the utilities used by the component are replicated.
const ICON_SWAP_VISIBILITY_CSS = String.raw`
  .opacity-0 { opacity: 0 }
  .group\/icon-swap[data-state='to'] .group-data-\[state\=to\]\/icon-swap\:opacity-0 { opacity: 0 }
  .group\/icon-swap[data-state='to'] .group-data-\[state\=to\]\/icon-swap\:opacity-100 { opacity: 1 }
`

describe('IconSwap', () => {
  it('user switches the state when swapping icons, then only the matching icon is presented', () => {
    const style = document.createElement('style')
    style.textContent = ICON_SWAP_VISIBILITY_CSS
    document.head.append(style)

    try {
      const { rerender } = render(iconSwap('from'))

      expect(screen.getByTestId('from-icon')).toBeVisible()
      expect(screen.getByTestId('to-icon')).not.toBeVisible()

      rerender(iconSwap('to'))

      expect(screen.getByTestId('from-icon')).not.toBeVisible()
      expect(screen.getByTestId('to-icon')).toBeVisible()
    } finally {
      style.remove()
    }
  })
})
