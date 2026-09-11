import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SidebarProvider } from '@mico/ui'
import type { Conversation } from '@renderer/types/chat'

import { AppSidebar } from './app-sidebar'

describe('AppSidebar', () => {
  it('does not revisit an unchanged conversation when another response status changes', () => {
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
    const props = {
      activeConversationId: 'conversation-1',
      conversations,
      onBackFromSettings: vi.fn(),
      onDeleteConversation: vi.fn(),
      onNewChat: vi.fn(),
      onOpenSettings: vi.fn(),
      onRenameConversation: vi.fn(),
      onSelectConversation: vi.fn(),
      respondingConversationIds: new Set<string>(),
      settingsActive: false
    }
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
