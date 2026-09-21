import '@testing-library/jest-dom/vitest'

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'

import { SidebarProvider } from '@mico/ui'
import type { Conversation } from '@renderer/types/chat'

import { ConversationRow } from './conversation-row'

type RowProps = ComponentProps<typeof ConversationRow>

function rowProps(conversation: Conversation, overrides: Partial<RowProps> = {}): RowProps {
  return {
    conversation,
    isResponding: false,
    onDeleteConversation: vi.fn<RowProps['onDeleteConversation']>(),
    onRenameConversation: vi.fn<RowProps['onRenameConversation']>(),
    onSelectConversation: vi.fn<RowProps['onSelectConversation']>(),
    selected: false,
    ...overrides
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('ConversationRow', () => {
  it('user sees the title animate only when clipped, then short titles stay static', () => {
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
          {...rowProps({ id: 'conversation-1', title: 'A very long conversation title' })}
        />
        <ConversationRow {...rowProps({ id: 'conversation-2', title: 'Short title' })} />
      </SidebarProvider>
    )

    const setTitleDimensions = (title: string, scrollWidth: number): HTMLButtonElement => {
      const button = screen.getByRole('button', { name: title })
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Conversation title must render as a button.')
      }

      // The row observes its title viewport for resizing; reuse the observed element directly
      // instead of probing the component's internal class names.
      const viewport = [...observers.keys()].find((element) => element.textContent === title)
      if (!(viewport instanceof HTMLSpanElement)) {
        throw new Error('Conversation title viewport must be observed for resizing.')
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
    // SAFETY: jsdom runs no CSS animations, so the custom properties driving the marquee are the
    // only handle for the visible scroll duration and distance.
    expect(longTitleButton).toHaveStyle({
      '--conversation-row-title-duration': '2500ms',
      '--conversation-row-title-offset': '120px'
    })
    expect(shortTitleButton).not.toHaveAttribute('data-title-overflowing')
  })

  it('user can rename when choosing Rename, then the input is focused and selected', async () => {
    const user = userEvent.setup()

    render(
      <SidebarProvider>
        <ConversationRow {...rowProps({ id: 'conversation-1', title: 'Design notes' })} />
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

  it('user sees a streaming indicator when responding, then the menu still opens', async () => {
    const user = userEvent.setup()

    render(
      <SidebarProvider>
        <ConversationRow
          {...rowProps(
            { id: 'conversation-1', title: 'Design notes' },
            { isResponding: true, selected: true }
          )}
        />
      </SidebarProvider>
    )

    expect(screen.getByRole('status', { name: 'Generating response' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'More actions' }))

    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeVisible()
  })

  it('user sees the indicator delay offset after 500 ms when appearing, then it holds', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    render(
      <SidebarProvider>
        <ConversationRow
          {...rowProps({ id: 'conversation-1', title: 'Design notes' }, { isResponding: true })}
        />
      </SidebarProvider>
    )

    const spinner = screen.getByRole('status', { name: 'Generating response' })
    expect(spinner).not.toHaveStyle({ animationDelay: '-500ms' })

    await act(() => vi.advanceTimersByTime(500))

    expect(spinner).toHaveStyle({ animationDelay: '-500ms' })
  })
})
