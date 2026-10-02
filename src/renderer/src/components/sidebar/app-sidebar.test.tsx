import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SidebarProvider } from '@mico/ui'
import type { Conversation } from '@renderer/types/chat'

import { AppSidebar } from './app-sidebar'

const sidebarProps = {
  activeConversationId: 'conversation-1',
  conversations: [
    { id: 'conversation-1', title: 'First conversation' },
    { id: 'conversation-2', title: 'Second conversation' }
  ],
  onBackFromSettings: vi.fn<() => void>(),
  onDeleteConversation: vi.fn<(conversationId: string) => void>(),
  onNewChat: vi.fn<() => void>(),
  onOpenSettings: vi.fn<() => void>(),
  onRenameConversation: vi.fn<(conversationId: string, title: string) => void>(),
  onSelectConversation:
    vi.fn<(conversationId: string, options?: { focusComposer?: boolean }) => void>(),
  respondingConversationIds: new Set<string>(),
  settingsActive: false
}

let electronDescriptor: PropertyDescriptor | undefined

describe('AppSidebar', () => {
  beforeEach(() => {
    electronDescriptor = Object.getOwnPropertyDescriptor(window, 'electron')
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { process: { platform: 'darwin' } }
    })
  })

  afterEach(() => {
    if (electronDescriptor) Object.defineProperty(window, 'electron', electronDescriptor)
    else Reflect.deleteProperty(window, 'electron')
  })

  function renderSidebar(overrides: Partial<typeof sidebarProps> = {}) {
    render(
      <SidebarProvider>
        <AppSidebar {...sidebarProps} {...overrides} />
      </SidebarProvider>
    )
  }

  it('user sees command shortcuts when holding the meta key, then they hide on release', () => {
    renderSidebar()

    fireEvent.keyDown(window, { key: 'Meta', metaKey: true })

    expect(screen.getByText('⌘ 1')).toBeVisible()
    expect(screen.getByText('⌘ 2')).toBeVisible()
    expect(screen.queryAllByRole('button', { name: 'More actions' })).toHaveLength(0)

    fireEvent.keyUp(window, { key: 'Meta' })

    expect(screen.queryByText('⌘ 1')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'More actions' })).toHaveLength(2)
  })

  it('user selects a conversation when pressing its command shortcut, then it opens', () => {
    const onSelectConversation =
      vi.fn<(conversationId: string, options?: { focusComposer?: boolean }) => void>()
    renderSidebar({ onSelectConversation })

    fireEvent.keyDown(window, { key: '2', metaKey: true })

    expect(onSelectConversation).toHaveBeenCalledWith('conversation-2')
  })

  it('user receives a status change for another conversation when rows are stable, then unchanged titles are not read again', () => {
    let stableTitleReads = 0
    const stableConversation = {
      id: 'conversation-1',
      get title() {
        stableTitleReads += 1
        return 'Stable conversation'
      }
    } satisfies Conversation
    const conversations = [
      stableConversation,
      { id: 'conversation-2', title: 'Streaming conversation' }
    ]
    const props = { ...sidebarProps, conversations, respondingConversationIds: new Set<string>() }
    const { rerender } = render(
      <SidebarProvider>
        <AppSidebar {...props} />
      </SidebarProvider>
    )
    const readsAfterInitialRender = stableTitleReads

    rerender(
      <SidebarProvider>
        <AppSidebar {...props} respondingConversationIds={new Set(['conversation-2'])} />
      </SidebarProvider>
    )

    expect(stableTitleReads).toBe(readsAfterInitialRender)
  })
})
