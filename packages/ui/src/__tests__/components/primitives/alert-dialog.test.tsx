import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '../../../components/primitives/alert-dialog'

describe('AlertDialog', () => {
  it('keeps a destructive action pending until the user confirms it', async () => {
    const user = userEvent.setup()
    function DeleteAction() {
      const [deleted, setDeleted] = useState(false)

      return (
        <>
          <AlertDialog open>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
                <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => setDeleted(true)}>Delete</AlertDialogAction>
              </AlertDialogFooter>
              <p>{deleted ? 'Deleted' : 'Pending'}</p>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )
    }

    render(<DeleteAction />)

    expect(screen.getByRole('alertdialog', { name: 'Delete conversation?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Pending')).toBeVisible()
  })

  it('runs the destructive action after confirmation', async () => {
    const user = userEvent.setup()
    function DeleteAction() {
      const [deleted, setDeleted] = useState(false)

      return (
        <>
          <AlertDialog open>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction onClick={() => setDeleted(true)}>Delete</AlertDialogAction>
              </AlertDialogFooter>
              <p>{deleted ? 'Deleted' : 'Pending'}</p>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )
    }

    render(<DeleteAction />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Deleted')).toBeVisible()
  })
})
