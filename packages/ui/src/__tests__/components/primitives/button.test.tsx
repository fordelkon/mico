import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { Button } from '../../../components/primitives/button'

describe('Button', () => {
  it('user clicks the button when it is enabled, then the action runs', async () => {
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

  it('user clicks the button when it is disabled, then the action does not run', async () => {
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

  it('user opens the settings link when the button renders a child anchor, then it presents as a link', () => {
    render(
      <Button asChild>
        <a href="/settings">Settings</a>
      </Button>
    )

    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
