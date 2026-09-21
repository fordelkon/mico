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
  it('user cancels the dialog when it is open, then nothing is deleted', async () => {
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

  it('user confirms the dialog when it is open, then the item is deleted', async () => {
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
