import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ChatWorkspace } from '@renderer/hooks/chat/use-chat-workspace-state'

import { ChatMain } from './chat-main'

function createWorkspace(): ChatWorkspace {
  return {
    conversations: [{ id: 'conversation-1', title: 'New chat' }],
    activeConversation: { id: 'conversation-1', title: 'New chat' },
    activeMessages: [],
    response: {
      status: 'retrying',
      conversationId: 'conversation-1',
      attempt: 2,
      maxAttempts: 5,
      retryDelayMs: 2_000,
      startedAt: Date.now()
    },
    reasoningCapabilities: null,
    thinkingEffort: 'medium',
    setThinkingEffort: vi.fn(),
    composerFocusKey: 1,
    startNewChat: vi.fn(),
    selectConversation: vi.fn(),
    renameConversation: vi.fn(),
    deleteConversation: vi.fn(),
    sendMessage: vi.fn(),
    retryResponse: vi.fn(),
    stopResponse: vi.fn()
  }
}

describe('ChatMain', () => {
  it('keeps the stop control available while a response is reconnecting', () => {
    render(<ChatMain workspace={createWorkspace()} />)

    expect(screen.getByRole('button', { name: 'Stop response' })).toBeVisible()
  })
})
