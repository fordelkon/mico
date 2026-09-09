import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Toggle } from '../../../components/composites/toggle'

describe('Toggle', () => {
  it('exposes switch semantics for its controlled checked state', () => {
    render(<Toggle aria-label="Enable notifications" checked={false} onCheckedChange={vi.fn()} />)

    expect(screen.getByRole('switch', { name: 'Enable notifications' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('requests the opposite checked state when clicked', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()

    render(
      <Toggle aria-label="Enable notifications" checked={false} onCheckedChange={onCheckedChange} />
    )

    await user.click(screen.getByRole('switch', { name: 'Enable notifications' }))

    expect(onCheckedChange).toHaveBeenCalledOnce()
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('does not request a state change when disabled', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()

    render(
      <Toggle
        aria-label="Enable notifications"
        checked={false}
        disabled
        onCheckedChange={onCheckedChange}
      />
    )

    const toggle = screen.getByRole('switch', { name: 'Enable notifications' })
    expect(toggle).toBeDisabled()

    await user.click(toggle)

    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})
