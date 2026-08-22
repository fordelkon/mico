import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '../dropdown-menu'

function renderOpenMenu(children: React.ReactNode) {
  render(
    <DropdownMenu open>
      <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}

describe('DropdownMenu', () => {
  it('renders an accessible menu and handles item selection', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderOpenMenu(<DropdownMenuItem onSelect={onSelect}>Rename</DropdownMenuItem>)

    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))

    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('does not select a disabled item', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderOpenMenu(
      <DropdownMenuItem disabled onSelect={onSelect}>
        Delete
      </DropdownMenuItem>
    )
    const item = screen.getByRole('menuitem', { name: 'Delete' })
    await user.click(item)

    expect(item).toHaveAttribute('data-disabled')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('renders an open submenu as another accessible menu', () => {
    renderOpenMenu(
      <DropdownMenuSub open>
        <DropdownMenuSubTrigger>Share</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem>Email</DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    )

    expect(screen.getAllByRole('menu')).toHaveLength(2)
    expect(screen.getByRole('menuitem', { name: 'Email' })).toBeInTheDocument()
  })
})
