import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '../../../components/primitives/context-menu'

describe('ContextMenu', () => {
  it('opens a custom menu on right-click and exposes its selected action', () => {
    function RenameAction() {
      const [renamed, setRenamed] = useState(false)

      return (
        <>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <button type="button">Conversation</button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => setRenamed(true)}>Rename</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          <output>{renamed ? 'Renamed' : 'Original title'}</output>
        </>
      )
    }

    render(<RenameAction />)

    const trigger = screen.getByRole('button', { name: 'Conversation' })
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    fireEvent(trigger, event)

    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeVisible()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(screen.getByRole('status')).toHaveTextContent('Renamed')
  })
})
