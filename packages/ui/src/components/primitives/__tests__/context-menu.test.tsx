import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '../context-menu'

describe('ContextMenu', () => {
  it('opens a custom menu on right-click and selects its action', () => {
    const onRename = vi.fn()

    render(
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button type="button">Conversation</button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onRename}>Rename</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )

    const trigger = screen.getByRole('button', { name: 'Conversation' })
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    fireEvent(trigger, event)

    expect(event.defaultPrevented).toBe(true)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(onRename).toHaveBeenCalledOnce()
  })
})
