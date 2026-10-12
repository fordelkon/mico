import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { SearchPopover } from '../../../components/composites/search-popover'
import { Button } from '../../../components/primitives/button'

describe('SearchPopover', () => {
  it('user picks an option when searching, then the popover closes and resets', async () => {
    const user = userEvent.setup()
    render(
      <SearchPopover
        contentClassName="w-64"
        searchLabel="Search options"
        searchPlaceholder="Search options"
        trigger={<Button>Choose option</Button>}
      >
        {({ close, query }) => (
          <div aria-label="Options" role="listbox">
            {query ? <Button onClick={close}>Selected {query}</Button> : null}
          </div>
        )}
      </SearchPopover>
    )

    await user.click(screen.getByRole('button', { name: 'Choose option' }))
    const searchInput = screen.getByRole('textbox', { name: 'Search options' })
    expect(searchInput).toHaveFocus()

    await user.type(searchInput, 'Nord')
    await user.click(screen.getByRole('button', { name: 'Selected Nord' }))

    expect(screen.queryByRole('listbox', { name: 'Options' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Choose option' }))
    expect(screen.getByRole('textbox', { name: 'Search options' })).toHaveValue('')
  })

  it('user toggles a popover when its open state is controlled, then the caller sees the changes', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn<(open: boolean) => void>()

    function ControlledPopover() {
      const [open, setOpen] = useState(false)

      return (
        <>
          <SearchPopover
            open={open}
            onOpenChange={(next) => {
              onOpenChange(next)
              setOpen(next)
            }}
            searchLabel="Search options"
            searchPlaceholder="Search options"
            trigger={<Button>Choose option</Button>}
          >
            {() => <p>Options</p>}
          </SearchPopover>
          <output>{open ? 'Open' : 'Closed'}</output>
        </>
      )
    }

    render(<ControlledPopover />)

    await user.click(screen.getByRole('button', { name: 'Choose option' }))

    expect(screen.getByRole('textbox', { name: 'Search options' })).toBeVisible()
    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(screen.getByRole('status')).toHaveTextContent('Open')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: 'Search options' })).toBeNull()
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('status')).toHaveTextContent('Closed')
  })
})
