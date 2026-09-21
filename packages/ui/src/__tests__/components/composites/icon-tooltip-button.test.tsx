import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { IconTooltipButton } from '../../../components/composites/icon-tooltip-button'

describe('IconTooltipButton', () => {
  it('user clicks the icon button when adding an item, then the action runs', async () => {
    const user = userEvent.setup()
    function AddAction() {
      const [added, setAdded] = useState(false)

      return (
        <>
          <IconTooltipButton
            className="custom-class"
            icon={<span>+</span>}
            label="Add item"
            onClick={() => setAdded(true)}
          />
          <output>{added ? 'Added' : 'Empty'}</output>
        </>
      )
    }

    render(<AddAction />)

    const button = screen.getByRole('button', { name: 'Add item' })
    await user.click(button)

    expect(button).toHaveClass('custom-class')
    expect(screen.getByText('+')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Added')
  })

  it('user focuses the icon button when it has a label, then the tooltip shows', () => {
    render(<IconTooltipButton icon={<svg />} label="Add item" />)
    fireEvent.focus(screen.getByRole('button', { name: 'Add item' }))

    expect(screen.getByRole('tooltip')).toHaveTextContent('Add item')
  })

  it('user focuses the button when custom content is set, then that tooltip shows', () => {
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

  it('user clicks the icon button when it is disabled, then it stays disabled', () => {
    render(<IconTooltipButton disabled icon={<svg />} label="Add item" size="icon-lg" />)

    const button = screen.getByRole('button', { name: 'Add item' })
    expect(button).toBeDisabled()
  })
})
