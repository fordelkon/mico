import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '../../../components/primitives/command'

describe('Command', () => {
  it('renders command children inside its dialog', () => {
    render(
      <CommandDialog open>
        <CommandInput placeholder="Search commands" />
        <CommandList>
          <CommandItem value="dark">Dark theme</CommandItem>
        </CommandList>
      </CommandDialog>
    )

    expect(screen.getByPlaceholderText('Search commands')).toBeInTheDocument()
  })

  it('filters commands by the query entered into its input', async () => {
    const user = userEvent.setup()

    render(
      <Command>
        <CommandInput placeholder="Search commands" />
        <CommandList>
          <CommandGroup heading="Appearance">
            <CommandItem value="light theme">Light theme</CommandItem>
            <CommandItem value="dark theme">Dark theme</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    )

    await user.type(screen.getByPlaceholderText('Search commands'), 'dark')

    expect(screen.getByRole('option', { name: 'Dark theme' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Light theme' })).not.toBeInTheDocument()
  })

  it('reports the selected command value when confirmed from the keyboard', async () => {
    const user = userEvent.setup()

    function ThemeCommand() {
      const [selection, setSelection] = useState('')

      return (
        <>
          <Command>
            <CommandInput placeholder="Search commands" />
            <CommandList>
              <CommandItem value="dark" onSelect={setSelection}>
                Dark theme
              </CommandItem>
            </CommandList>
          </Command>
          <output>{selection}</output>
        </>
      )
    }

    render(<ThemeCommand />)

    await user.click(screen.getByPlaceholderText('Search commands'))
    await user.keyboard('{Enter}')

    expect(screen.getByText('dark')).toBeInTheDocument()
  })
})
