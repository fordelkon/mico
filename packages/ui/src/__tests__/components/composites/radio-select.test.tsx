import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'

import { RadioSelect } from '../../../components/composites/radio-select'

describe('RadioSelect', () => {
  it('user selects an option when clicking it, then the trigger shows the value', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn<(value: string) => void>()

    function CodeThemeSelect() {
      const [value, setValue] = React.useState('auto')
      return (
        <RadioSelect
          aria-label="Code theme"
          onValueChange={(nextValue) => {
            onValueChange(nextValue)
            setValue(nextValue)
          }}
          options={[
            { label: 'Auto', value: 'auto' },
            { label: 'GitHub Dark', value: 'github-dark' }
          ]}
          value={value}
        />
      )
    }

    render(<CodeThemeSelect />)

    await user.click(screen.getByRole('button', { name: 'Code theme' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'GitHub Dark' }))

    expect(onValueChange).toHaveBeenCalledOnce()
    expect(onValueChange).toHaveBeenCalledWith('github-dark')
    expect(screen.getByRole('button', { name: 'Code theme' })).toHaveTextContent('GitHub Dark')
  })

  it('user cannot open the select when it is disabled, then no menu renders', async () => {
    const user = userEvent.setup()

    render(
      <RadioSelect
        aria-label="Code theme"
        disabled
        onValueChange={vi.fn<(value: string) => void>()}
        options={[{ label: 'Auto', value: 'auto' }]}
        value="auto"
      />
    )

    const trigger = screen.getByRole('button', { name: 'Code theme' })
    expect(trigger).toBeDisabled()

    await user.click(trigger)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
