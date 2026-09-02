import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '../../../components/primitives/dropdown-menu'

function renderOpenMenu(children: React.ReactNode) {
  render(
    <DropdownMenu open>
      <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}

describe('DropdownMenu', () => {
  it('renders an accessible menu and exposes item selection', async () => {
    const user = userEvent.setup()
    function RenameAction() {
      const [renamed, setRenamed] = useState(false)

      return (
        <>
          <DropdownMenu open>
            <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => setRenamed(true)}>
                {renamed ? 'Renamed' : 'Rename'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )
    }

    render(<RenameAction />)

    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))

    expect(screen.getByRole('menuitem', { name: 'Renamed' })).toBeVisible()
  })

  it('does not select a disabled item', async () => {
    const user = userEvent.setup()
    function DeleteAction() {
      const [deleted, setDeleted] = useState(false)

      return (
        <>
          <DropdownMenu open>
            <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem disabled onSelect={() => setDeleted(true)}>
                {deleted ? 'Deleted' : 'Delete'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )
    }

    render(<DeleteAction />)
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))

    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
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
