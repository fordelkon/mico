import '@testing-library/jest-dom/vitest'

import { Button } from '@mico/ui/components/primitives/button'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { SearchPopover } from '../../../components/composites/search-popover'

describe('SearchPopover', () => {
  it('focuses the query, passes it to the caller, and closes on selection', async () => {
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
})
