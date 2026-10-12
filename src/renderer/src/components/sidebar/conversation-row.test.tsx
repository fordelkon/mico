import '@testing-library/jest-dom/vitest'

import { SidebarProvider } from '@mico/ui'
import type { Conversation } from '@renderer/types/chat'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConversationRow } from './conversation-row'

type RowProps = ComponentProps<typeof ConversationRow>

function rowProps(conversation: Conversation, overrides: Partial<RowProps> = {}): RowProps {
  return {
    conversation,
    isResponding: false,
    onDeleteConversation: vi.fn<RowProps['onDeleteConversation']>(async () => {}),
    onRenameConversation: vi.fn<RowProps['onRenameConversation']>(async () => {}),
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
  it('user opens actions when a summary is pending, then deletion waits without sidebar feedback', async () => {
    const user = userEvent.setup()
    render(
      <SidebarProvider>
        <ConversationRow
          {...rowProps({ id: 'conversation-1', title: 'Design notes' }, { isCompacting: true })}
        />
      </SidebarProvider>
    )
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(screen.queryByRole('menuitem', { name: 'Compact context' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Cancel summary' })).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Design notes' }))
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(screen.queryByRole('menuitem', { name: 'Compact context' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Cancel summary' })).not.toBeInTheDocument()
  })

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

  it('user saves a title when renaming fails, then the draft stays editable for retry', async () => {
    const user = userEvent.setup()
    const rename = vi
      .fn<(_id: string, _title: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('Could not rename this conversation. Try again.'))
      .mockResolvedValue(undefined)
    render(
      <SidebarProvider>
        <ConversationRow
          {...rowProps(
            { id: 'conversation-1', title: 'Design notes' },
            { onRenameConversation: rename }
          )}
        />
      </SidebarProvider>
    )
    await user.dblClick(screen.getByRole('button', { name: 'Design notes' }))
    const input = screen.getByRole('textbox', { name: 'Conversation title' })
    await user.clear(input)
    await user.type(input, 'Release notes{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent('Try again.')
    expect(screen.getByRole('textbox', { name: 'Conversation title' })).toHaveValue('Release notes')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    expect(rename).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([false, true])(
    'user deletes a chat when persistence fails with reduced motion=%s, then its row recovers',
    async (reducedMotion) => {
      const user = userEvent.setup()
      // The browser preference is external to jsdom; exercise both deletion paths deterministically.
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: reducedMotion && query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener: vi.fn<MediaQueryList['addEventListener']>(),
        removeEventListener: vi.fn<MediaQueryList['removeEventListener']>()
      }))
      const remove = vi
        .fn<(_id: string) => Promise<void>>()
        .mockRejectedValueOnce(new Error('Could not delete this conversation. Try again.'))
        .mockResolvedValue(undefined)
      render(
        <SidebarProvider>
          <ConversationRow
            {...rowProps(
              { id: 'conversation-1', title: 'Design notes' },
              { onDeleteConversation: remove }
            )}
          />
        </SidebarProvider>
      )
      const requestDelete = async (): Promise<void> => {
        await user.click(screen.getByRole('button', { name: 'More actions' }))
        await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
        await user.click(screen.getByRole('button', { name: 'Delete' }))
        if (!reducedMotion) {
          // jsdom lacks AnimationEvent, so React listens for the WebKit-prefixed completion.
          // Deliver the named keyframe event explicitly; jsdom does not execute CSS animations.
          const completion = new Event('webkitAnimationEnd', { bubbles: true })
          Object.defineProperty(completion, 'animationName', { value: 'conversation-row-delete' })
          fireEvent(screen.getByRole('listitem'), completion)
        }
      }
      await requestDelete()

      expect(await screen.findByRole('alert')).toHaveTextContent('Try again.')
      expect(screen.getByRole('button', { name: 'Design notes' })).toBeEnabled()
      expect(screen.getByRole('listitem')).not.toHaveAttribute('aria-busy')
      await requestDelete()
      await waitFor(() => expect(remove).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    }
  )

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
