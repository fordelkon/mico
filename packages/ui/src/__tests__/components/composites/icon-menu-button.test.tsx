import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { DropdownMenuItem } from '../../../components/primitives/dropdown-menu'
import { IconMenuButton } from '../../../components/composites/icon-menu-button'

describe('IconMenuButton', () => {
  it('user clicks the icon button when it has a label, then the menu items show', async () => {
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

  it('user clicks the trigger when it is disabled, then the menu does not open', async () => {
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

  it('user opens the menu when a custom content width is set, then the menu opens with it', async () => {
    const user = userEvent.setup()

    render(
      <IconMenuButton icon={<svg />} label="Browse models" menuContentClassName="w-72">
        <DropdownMenuItem>Model A</DropdownMenuItem>
      </IconMenuButton>
    )

    await user.click(screen.getByRole('button', { name: 'Browse models' }))

    expect(screen.getByRole('menu')).toHaveClass('w-72')
  })
})
