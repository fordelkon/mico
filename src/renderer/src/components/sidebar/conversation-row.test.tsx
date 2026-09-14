import '@testing-library/jest-dom/vitest'

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SidebarProvider } from '@mico/ui'

import { ConversationRow } from './conversation-row'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('ConversationRow', () => {
  it('only enables title translation when the title is clipped', () => {
    const observers = new Map<Element, () => void>()

    class ResizeObserverMock {
      constructor(private readonly callback: () => void) {}

      observe(target: Element): void {
        observers.set(target, this.callback)
      }

      disconnect(): void {
        observers.clear()
      }
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)

    render(
      <SidebarProvider>
        <ConversationRow
          conversation={{ id: 'conversation-1', title: 'A very long conversation title' }}
          isResponding={false}
          onDeleteConversation={vi.fn()}
          onRenameConversation={vi.fn()}
          onSelectConversation={vi.fn()}
          selected={false}
        />
        <ConversationRow
          conversation={{ id: 'conversation-2', title: 'Short title' }}
          isResponding={false}
          onDeleteConversation={vi.fn()}
          onRenameConversation={vi.fn()}
          onSelectConversation={vi.fn()}
          selected={false}
        />
      </SidebarProvider>
    )

    const setTitleDimensions = (title: string, scrollWidth: number): HTMLButtonElement => {
      const button = screen.getByRole('button', { name: title })
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Conversation title must render as a button.')
      }

      const viewport = button.querySelector('.conversation-row__title-viewport')
      if (!(viewport instanceof HTMLSpanElement)) {
        throw new Error('Conversation title viewport must render as a span.')
      }

      Object.defineProperties(viewport, {
        clientWidth: { configurable: true, value: 100 },
        scrollWidth: { configurable: true, value: scrollWidth }
      })

      const observer = observers.get(viewport)
      if (!observer) throw new Error('Conversation title viewport must be observed for resizing.')
      act(() => observer())
      return button
    }

    const longTitleButton = setTitleDimensions('A very long conversation title', 220)
    const shortTitleButton = setTitleDimensions('Short title', 100)

    expect(longTitleButton).toHaveAttribute('data-title-overflowing', 'true')
    expect(longTitleButton).toHaveStyle({
      '--conversation-row-title-duration': '2500ms',
      '--conversation-row-title-offset': '120px'
    })
    expect(shortTitleButton).not.toHaveAttribute('data-title-overflowing')
  })

  it('focuses and selects the title after renaming from the context menu', async () => {
    const user = userEvent.setup()

    render(
      <SidebarProvider>
        <ConversationRow
          conversation={{ id: 'conversation-1', title: 'Design notes' }}
          isResponding={false}
          onDeleteConversation={vi.fn()}
          onRenameConversation={vi.fn()}
          onSelectConversation={vi.fn()}
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
          onDeleteConversation={vi.fn()}
          onRenameConversation={vi.fn()}
          onSelectConversation={vi.fn()}
          selected={true}
        />
      </SidebarProvider>
    )

    expect(screen.getByRole('status', { name: 'Generating response' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'More actions' }))

    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeVisible()
  })

  it('locks a streaming indicator to the shared animation phase after its introduction', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    render(
      <SidebarProvider>
        <ConversationRow
          conversation={{ id: 'conversation-1', title: 'Design notes' }}
          isResponding
          onDeleteConversation={vi.fn()}
          onRenameConversation={vi.fn()}
          onSelectConversation={vi.fn()}
          selected={false}
        />
      </SidebarProvider>
    )

    const spinner = screen.getByRole('status', { name: 'Generating response' })
    expect(spinner).not.toHaveStyle({ animationDelay: '-500ms' })

    await act(() => vi.advanceTimersByTime(500))

    expect(spinner).toHaveStyle({ animationDelay: '-500ms' })
  })
})
