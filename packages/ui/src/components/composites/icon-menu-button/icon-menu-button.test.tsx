import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DropdownMenuItem } from '../../primitives/dropdown-menu'
import { IconMenuButton } from './icon-menu-button'

describe('IconMenuButton', () => {
  it('opens an accessible menu on click and renders menu primitives passed as children', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <IconMenuButton icon={<svg data-testid="custom-icon" />} label="More actions">
        <DropdownMenuItem onSelect={onSelect}>Rename</DropdownMenuItem>
      </IconMenuButton>
    )

    const button = screen.getByRole('button', { name: 'More actions' })
    expect(button).toHaveAttribute('data-variant', 'ghost')
    expect(button).toHaveAttribute('data-size', 'icon')
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument()

    await user.click(button)

    const menu = screen.getByRole('menu')
    expect(menu).toHaveAttribute('data-side', 'bottom')
    expect(menu).toHaveAttribute('data-align', 'center')

    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(onSelect).toHaveBeenCalledOnce()
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
    expect(button).toHaveAttribute('data-size', 'icon-sm')
    expect(button).toHaveClass('custom-class')

    await user.click(button)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
