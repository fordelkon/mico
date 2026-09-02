import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { Button } from '../../../components/primitives/button'

describe('Button', () => {
  it('activates the action a consumer attaches to it', async () => {
    const user = userEvent.setup()
    function SaveAction() {
      const [saved, setSaved] = useState(false)

      return (
        <>
          <Button onClick={() => setSaved(true)}>Save</Button>
          <output>{saved ? 'Saved' : 'Unsaved'}</output>
        </>
      )
    }

    render(<SaveAction />)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })

  it('prevents activation when disabled', async () => {
    const user = userEvent.setup()
    function SaveAction() {
      const [saved, setSaved] = useState(false)

      return (
        <>
          <Button disabled onClick={() => setSaved(true)}>
            Save
          </Button>
          <output>{saved ? 'Saved' : 'Unsaved'}</output>
        </>
      )
    }

    render(<SaveAction />)
    const button = screen.getByRole('button', { name: 'Save' })
    await user.click(button)

    expect(button).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved')
  })

  it('can delegate its semantics to a child element', () => {
    render(
      <Button asChild>
        <a href="/settings">Settings</a>
      </Button>
    )

    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
