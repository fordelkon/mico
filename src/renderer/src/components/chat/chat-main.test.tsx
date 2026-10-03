import '@testing-library/jest-dom/vitest'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatActiveSessionSlice } from '@renderer/hooks/chat/use-active-session'
import type { ChatResponseSlice } from '@renderer/hooks/chat/use-chat-workspace-state'
import type { ModelReasoningCapabilities, ThinkingSelection } from '@shared/data/schemas/chat'
import type { WorkspaceProject } from '@shared/data/schemas/workspace'

import { ChatMain } from './chat-main'
import { ProviderLibraryProvider } from '@renderer/components/settings/providers/provider-library'

Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
  configurable: true,
  value: () => undefined
})

function createSessionSlice(): ChatActiveSessionSlice {
  return {
    activeConversation: { id: 'conversation-1', title: 'New chat' },
    activeSession: null,
    activeChat: null,
    permissionMode: 'default',
    setPermissionMode: vi.fn<ChatActiveSessionSlice['setPermissionMode']>(),
    thinkingEffort: 'medium',
    setThinkingEffort: vi.fn<(thinkingEffort: ThinkingSelection) => void>(),
    reasoningCapabilities: null,
    refreshCapabilities: vi.fn<ChatActiveSessionSlice['refreshCapabilities']>(),
    activationError: null,
    selectedModelEntryId: null,
    setSessionModelEntry: vi.fn<(modelEntryId: string) => Promise<void>>(),
    projects: [],
    pendingProject: null,
    activeProject: null,
    composerFocusKey: 1,
    refreshProjects: vi.fn<() => Promise<void>>(),
    addProjectToNewChat: vi.fn<() => Promise<void>>(),
    selectProjectForNewChat: vi.fn<(project: WorkspaceProject) => void>(),
    startNewChat: vi.fn<() => void>(),
    selectConversation:
      vi.fn<(conversationId: string, options?: { focusComposer?: boolean }) => void>(),
    activateNewSession: vi.fn<ChatActiveSessionSlice['activateNewSession']>(),
    closeSessionIfActive: vi.fn<(conversationId: string) => void>()
  }
}

function createResponseSlice(): ChatResponseSlice {
  return {
    response: {
      status: 'retrying',
      conversationId: 'conversation-1',
      attempt: 2,
      maxAttempts: 5,
      retryDelayMs: 2_000,
      startedAt: Date.now()
    },
    respondingConversationIds: new Set(['conversation-1']),
    sendMessage:
      vi.fn<(content: Parameters<ChatResponseSlice['sendMessage']>[0]) => Promise<boolean>>(),
    retryResponse: vi.fn<() => void>(),
    stopResponse: vi.fn<() => void>()
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
      // SAFETY: the provider library is served with the model unselected, then selected.
      selectedModelId: null as string | null
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        chat: {
          getCapabilities: vi
            .fn<() => Promise<ModelReasoningCapabilities | null>>()
            .mockResolvedValue(null)
        },
        providers: {
          getLibrary: vi
            .fn<() => Promise<typeof library>>()
            .mockResolvedValueOnce(library)
            .mockResolvedValue({ ...library, selectedModelId: 'ollama:qwen3' }),
          // The provider context flushes unsaved drafts on unmount; keep it a no-op here.
          saveLibrary: vi
            .fn<(persisted: typeof library) => Promise<typeof library>>()
            .mockImplementation(async (persisted) => persisted),
          selectModel: vi
            .fn<(modelId: string | null) => Promise<string | null>>()
            .mockResolvedValue('ollama:qwen3')
        },
        windowControls: {
          onProviderDraftFlush: vi
            .fn<(listener: () => Promise<void>) => () => void>()
            .mockReturnValue(() => undefined)
        }
      }
    })
  })

  it('user keeps the stop control when a response reconnects, then it stays visible', () => {
    render(
      <ProviderLibraryProvider>
        <ChatMain session={createSessionSlice()} responses={createResponseSlice()} />
      </ProviderLibraryProvider>
    )

    expect(screen.getByRole('button', { name: 'Stop response' })).toBeVisible()
  })

  it('user cannot open a saved conversation when loading fails, then a retry instruction is visible', () => {
    const session = createSessionSlice()
    session.activationError = 'Could not open this conversation. Select it again to retry.'
    render(
      <ProviderLibraryProvider>
        <ChatMain session={session} responses={createResponseSlice()} />
      </ProviderLibraryProvider>
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not open this conversation. Select it again to retry.'
    )
  })

  it('user stores the chosen model when picking it from the composer, then it persists', async () => {
    const user = userEvent.setup()
    const session = createSessionSlice()

    render(
      <ProviderLibraryProvider>
        <ChatMain session={session} responses={createResponseSlice()} />
      </ProviderLibraryProvider>
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Select model' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Select model' }))
    await user.click(screen.getByRole('option', { name: 'Qwen 3 8B' }))

    await waitFor(() => expect(session.setSessionModelEntry).toHaveBeenCalledWith('ollama:qwen3'))
  })
})
