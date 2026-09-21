import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Toggle } from '../../../components/composites/toggle'

function renderToggle(onCheckedChange: (checked: boolean) => void, disabled = false) {
  render(
    <Toggle
      aria-label="Enable notifications"
      checked={false}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
    />
  )
}

describe('Toggle', () => {
  it('user renders the switch when it is controlled, then aria-checked reflects it', () => {
    renderToggle(vi.fn<(checked: boolean) => void>())

    expect(screen.getByRole('switch', { name: 'Enable notifications' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('user clicks the switch when it is enabled, then onCheckedChange is called', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn<(checked: boolean) => void>()

    renderToggle(onCheckedChange)

    await user.click(screen.getByRole('switch', { name: 'Enable notifications' }))

    expect(onCheckedChange).toHaveBeenCalledOnce()
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('user clicks the switch when it is disabled, then no change is requested', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn<(checked: boolean) => void>()

    renderToggle(onCheckedChange, true)

    const toggle = screen.getByRole('switch', { name: 'Enable notifications' })
    expect(toggle).toBeDisabled()

    await user.click(toggle)

    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})
