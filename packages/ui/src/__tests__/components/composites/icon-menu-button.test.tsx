import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { DropdownMenuItem } from '../../../components/primitives/dropdown-menu'
import { IconMenuButton } from '../../../components/composites/icon-menu-button'

describe('IconMenuButton', () => {
  it('opens an accessible labelled menu on click', async () => {
    const user = userEvent.setup()

    render(
      <IconMenuButton icon={<span>⋯</span>} label="More actions">
        <DropdownMenuItem>Rename</DropdownMenuItem>
      </IconMenuButton>
    )

    const button = screen.getByRole('button', { name: 'More actions' })
    expect(screen.getByText('⋯')).toBeVisible()

    await user.click(button)

    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeVisible()
  })

  it('forwards supported button props and prevents a disabled trigger from opening the menu', async () => {
    const user = userEvent.setup()

    render(
      <IconMenuButton
        className="custom-class"
        disabled
        icon={<svg />}
        label="More actions"
        size="icon-sm"
      >
        <DropdownMenuItem>Rename</DropdownMenuItem>
      </IconMenuButton>
    )

    const button = screen.getByRole('button', { name: 'More actions' })
    expect(button).toBeDisabled()
    expect(button).toHaveClass('custom-class')

    await user.click(button)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
