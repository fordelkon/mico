import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SidebarProvider } from '@mico/ui'

import { ConversationRow } from './conversation-row'

describe('ConversationRow', () => {
  it('focuses and selects the title after renaming from the context menu', async () => {
    const user = userEvent.setup()

    render(
      <SidebarProvider>
        <ConversationRow
          conversation={{ id: 'conversation-1', title: 'Design notes' }}
          isResponding={false}
          onDelete={vi.fn()}
          onRename={vi.fn()}
          onSelect={vi.fn()}
          selected={false}
        />
      </SidebarProvider>
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Design notes' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))

    const input = await screen.findByRole('textbox', { name: 'Conversation title' })
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Conversation title must render as an input.')
    }
    await waitFor(() => expect(input).toHaveFocus())
    expect(input).toHaveValue('Design notes')
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('Design notes'.length)
  })

  it('shows a streaming indicator without blocking conversation actions', async () => {
    const user = userEvent.setup()

    render(
      <SidebarProvider>
        <ConversationRow
          conversation={{ id: 'conversation-1', title: 'Design notes' }}
          isResponding
          onDelete={vi.fn()}
          onRename={vi.fn()}
          onSelect={vi.fn()}
          selected={true}
        />
      </SidebarProvider>
    )

    expect(screen.getByRole('status', { name: 'Generating response' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'More actions' }))

    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeVisible()
  })
})
