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
    activeChat: null,
    response: {
      status: 'retrying',
      conversationId: 'conversation-1',
      attempt: 2,
      maxAttempts: 5,
      retryDelayMs: 2_000,
      startedAt: Date.now()
    },
    respondingConversationIds: new Set(['conversation-1']),
    reasoningCapabilities: null,
    thinkingEffort: 'medium',
    selectedModelEntryId: null,
    pendingProject: null,
    addProjectToNewChat: vi.fn(),
    setThinkingEffort: vi.fn(),
    setSessionModelEntry: vi.fn(),
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

  it('persists a model selected from the composer on the active session', async () => {
    const user = userEvent.setup()
    const workspace = createWorkspace()

    render(<ChatMain workspace={workspace} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Select model' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Select model' }))
    await user.click(screen.getByRole('option', { name: 'Qwen 3 8B' }))

    await waitFor(() => expect(workspace.setSessionModelEntry).toHaveBeenCalledWith('ollama:qwen3'))
  })

  it('turns off thinking when a newly selected model has no reasoning capabilities', async () => {
    const user = userEvent.setup()
    const workspace = createWorkspace()

    render(<ChatMain workspace={workspace} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Select model' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Select model' }))
    await user.click(screen.getByRole('option', { name: 'Qwen 3 8B' }))

    await waitFor(() => expect(workspace.setThinkingEffort).toHaveBeenCalledWith('none'))
  })
})
