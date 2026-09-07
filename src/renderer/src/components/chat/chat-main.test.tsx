import '@testing-library/jest-dom/vitest'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatWorkspace } from '@renderer/hooks/chat/use-chat-workspace-state'

import { ChatMain } from './chat-main'

Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
  configurable: true,
  value: () => undefined
})

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
  beforeEach(() => {
    const library = {
      configurations: [
        { provider: 'ollama' as const, baseUrl: 'http://localhost:11434', enabled: true }
      ],
      customProviders: [],
      models: [
        {
          id: 'ollama:qwen3',
          provider: 'ollama',
          modelId: 'qwen3:8b',
          displayName: 'Qwen 3 8B',
          enabled: true
        }
      ],
      selectedModelId: null
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        chat: { getCapabilities: vi.fn().mockResolvedValue(null) },
        providers: {
          getLibrary: vi
            .fn()
            .mockResolvedValueOnce(library)
            .mockResolvedValue({ ...library, selectedModelId: 'ollama:qwen3' }),
          selectModel: vi.fn().mockResolvedValue('ollama:qwen3')
        }
      }
    })
  })

  it('keeps the stop control available while a response is reconnecting', () => {
    render(<ChatMain workspace={createWorkspace()} />)

    expect(screen.getByRole('button', { name: 'Stop response' })).toBeVisible()
  })

  it('persists a model selected from the composer', async () => {
    const user = userEvent.setup()

    render(<ChatMain workspace={createWorkspace()} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Select model' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Select model' }))
    await user.click(screen.getByRole('option', { name: 'Qwen 3 8B' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Qwen 3 8B' })).toBeVisible())
  })
})
