import '@testing-library/jest-dom/vitest'

import { Chat } from '@ai-sdk/react'
import { ProviderLibraryProvider } from '@renderer/components/settings/providers/provider-library'
import type { ChatCompactionsStore } from '@renderer/hooks/chat/chat-session-instances'
import type { ChatActiveSessionSlice } from '@renderer/hooks/chat/use-active-session'
import type { ChatResponseSlice } from '@renderer/hooks/chat/use-chat-workspace-state'
import type { MicoUIMessage } from '@renderer/types/chat'
import type { ToolPermissionData } from '@shared/ai/permissions'
import type { ModelReasoningCapabilities, ThinkingSelection } from '@shared/data/schemas/chat'
import type { WorkspaceProject } from '@shared/data/schemas/workspace'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatMain } from './chat-main'

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
    createNewSession: vi.fn<ChatActiveSessionSlice['createNewSession']>(),
    closeSessionIfActive: vi.fn<(conversationId: string) => void>()
  }
}

function createCompactions(): ChatCompactionsStore {
  return {
    states: new Map(),
    startCompaction: vi.fn<ChatCompactionsStore['startCompaction']>(),
    cancelCompaction: vi.fn<ChatCompactionsStore['cancelCompaction']>()
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

const pendingPermission: ToolPermissionData = {
  approvalId: '00000000-0000-4000-8000-000000000001',
  toolCallId: 'bash-approval',
  toolName: 'Bash',
  cwd: '/workspace',
  input: { command: 'echo approval-demo' },
  reason: 'This command runs on your computer.',
  state: 'pending'
}

function approvalMessage(permissions: ToolPermissionData[]): MicoUIMessage {
  return {
    id: 'assistant-approval',
    role: 'assistant',
    parts: [
      ...[
        ...new Map(permissions.map((permission) => [permission.toolCallId, permission])).values()
      ].map((permission) => ({
        type: 'dynamic-tool' as const,
        toolName: permission.toolName,
        toolCallId: permission.toolCallId,
        state: 'input-available' as const,
        input: permission.input
      })),
      ...permissions.map((permission) => ({
        type: 'data-tool-permission' as const,
        data: permission
      }))
    ]
  }
}

describe('ChatMain', () => {
  it('user cancels an inline summary when pending, then sending waits for its outcome', async () => {
    const user = userEvent.setup()
    const compactions = createCompactions()
    compactions.states = new Map([
      ['conversation-1', { status: 'pending', requestId: 'summary-1' }]
    ])
    const session = {
      ...createSessionSlice(),
      activeChat: new Chat<MicoUIMessage>({ id: 'summary-chat', messages: [] })
    }
    render(
      <ProviderLibraryProvider>
        <ChatMain
          compactions={compactions}
          session={session}
          responses={{ ...createResponseSlice(), response: { status: 'idle' } }}
        />
      </ProviderLibraryProvider>
    )
    const transcript = await screen.findByLabelText('Messages')
    expect(within(transcript).getByRole('status')).toHaveTextContent('Summarizing conversation…')
    expect(screen.getByRole('textbox')).toBeDisabled()
    await user.click(within(transcript).getByRole('button', { name: 'Cancel summary' }))
    expect(compactions.cancelCompaction).toHaveBeenCalledWith('conversation-1')
    expect(within(transcript).getByRole('status')).toHaveTextContent('Summarizing conversation…')
  })

  it.each([
    { status: 'accepted' as const, text: 'Context compacted.', role: 'status' },
    { status: 'cancelled' as const, text: 'Summary cancelled.', role: 'status' },
    {
      status: 'failed' as const,
      message: 'Could not summarize this conversation. Use /compact to try again.',
      text: 'Use /compact to try again.',
      role: 'alert'
    },
    {
      status: 'pending' as const,
      requestId: 'summary-1',
      error: 'Could not confirm summary cancellation. Try Cancel summary again.',
      text: 'Try Cancel summary again.',
      role: 'alert'
    }
  ])(
    'user views summary outcome $status when active, then inline feedback is visible',
    async (state) => {
      const compactions = createCompactions()
      compactions.states = new Map([['conversation-1', state]])
      const session = {
        ...createSessionSlice(),
        activeChat: new Chat<MicoUIMessage>({ id: 'summary-chat', messages: [] })
      }
      const { rerender } = render(
        <ProviderLibraryProvider>
          <ChatMain
            compactions={compactions}
            session={session}
            responses={{ ...createResponseSlice(), response: { status: 'idle' } }}
          />
        </ProviderLibraryProvider>
      )
      const transcript = await screen.findByLabelText('Messages')
      expect(within(transcript).getByRole(state.role)).toHaveTextContent(state.text)
      rerender(
        <ProviderLibraryProvider>
          <ChatMain
            compactions={compactions}
            session={{
              ...session,
              activeConversation: { id: 'conversation-2', title: 'Other chat' },
              activeChat: new Chat<MicoUIMessage>({ id: 'other-chat', messages: [] })
            }}
            responses={{ ...createResponseSlice(), response: { status: 'idle' } }}
          />
        </ProviderLibraryProvider>
      )
      expect(screen.queryByText(state.text, { exact: false })).not.toBeInTheDocument()
    }
  )

  it('user retries a failed summary when its notice offers retry, then the compaction owner starts a new request', async () => {
    const user = userEvent.setup()
    const compactions = createCompactions()
    compactions.states = new Map([
      [
        'conversation-1',
        {
          status: 'failed' as const,
          message: 'Could not summarize this conversation. Use /compact to try again.'
        }
      ]
    ])
    const session = {
      ...createSessionSlice(),
      activeChat: new Chat<MicoUIMessage>({ id: 'summary-retry', messages: [] })
    }
    render(
      <ProviderLibraryProvider>
        <ChatMain
          compactions={compactions}
          session={session}
          responses={{ ...createResponseSlice(), response: { status: 'idle' } }}
        />
      </ProviderLibraryProvider>
    )
    const transcript = await screen.findByLabelText('Messages')
    await user.click(within(transcript).getByRole('button', { name: 'Retry summary' }))
    expect(compactions.startCompaction).toHaveBeenCalledWith('conversation-1')
  })

  it('user sees retry disabled when a response is still active, then the failed summary stays visible', async () => {
    const compactions = createCompactions()
    compactions.states = new Map([
      [
        'conversation-1',
        { status: 'failed' as const, message: 'Could not summarize this conversation.' }
      ]
    ])
    const session = {
      ...createSessionSlice(),
      activeChat: new Chat<MicoUIMessage>({ id: 'summary-retry-busy', messages: [] })
    }
    render(
      <ProviderLibraryProvider>
        <ChatMain
          compactions={compactions}
          session={session}
          responses={{
            ...createResponseSlice(),
            response: { status: 'streaming', conversationId: 'conversation-1' }
          }}
        />
      </ProviderLibraryProvider>
    )
    const transcript = await screen.findByLabelText('Messages')
    expect(within(transcript).getByRole('button', { name: 'Retry summary' })).toBeDisabled()
    expect(within(transcript).getByRole('alert')).toBeVisible()
  })

  it('user dismisses a failed summary notice when the outcome persists, then it stays hidden until a new attempt', async () => {
    const user = userEvent.setup()
    const compactions = createCompactions()
    const failedState = {
      status: 'failed' as const,
      message: 'Could not summarize this conversation. Use /compact to try again.'
    }
    compactions.states = new Map([['conversation-1', failedState]])
    const session = {
      ...createSessionSlice(),
      activeChat: new Chat<MicoUIMessage>({ id: 'summary-dismiss', messages: [] })
    }
    const view = render(
      <ProviderLibraryProvider>
        <ChatMain
          compactions={compactions}
          session={session}
          responses={{ ...createResponseSlice(), response: { status: 'idle' } }}
        />
      </ProviderLibraryProvider>
    )
    const transcript = await screen.findByLabelText('Messages')
    await user.click(within(transcript).getByRole('button', { name: 'Dismiss' }))
    expect(within(transcript).queryByRole('alert')).not.toBeInTheDocument()

    // The acknowledged outcome stays hidden while the owner keeps it published.
    view.rerender(
      <ProviderLibraryProvider>
        <ChatMain
          compactions={compactions}
          session={session}
          responses={{ ...createResponseSlice(), response: { status: 'idle' } }}
        />
      </ProviderLibraryProvider>
    )
    expect(within(transcript).queryByRole('alert')).not.toBeInTheDocument()

    // A new attempt has its own state and becomes visible again.
    compactions.states = new Map([
      ['conversation-1', { status: 'pending' as const, requestId: 'summary-2' }]
    ])
    view.rerender(
      <ProviderLibraryProvider>
        <ChatMain
          compactions={compactions}
          session={session}
          responses={{ ...createResponseSlice(), response: { status: 'idle' } }}
        />
      </ProviderLibraryProvider>
    )
    expect(within(transcript).getByRole('status')).toHaveTextContent('Summarizing conversation…')
  })

  it('user dismisses a settled summary outcome when it is acknowledged, then it stays hidden', async () => {
    const user = userEvent.setup()
    const compactions = createCompactions()
    compactions.states = new Map([['conversation-1', { status: 'accepted' as const }]])
    const session = {
      ...createSessionSlice(),
      activeChat: new Chat<MicoUIMessage>({ id: 'summary-accepted', messages: [] })
    }
    const view = render(
      <ProviderLibraryProvider>
        <ChatMain
          compactions={compactions}
          session={session}
          responses={{ ...createResponseSlice(), response: { status: 'idle' } }}
        />
      </ProviderLibraryProvider>
    )
    const transcript = await screen.findByLabelText('Messages')
    await user.click(within(transcript).getByRole('button', { name: 'Dismiss' }))
    expect(within(transcript).queryByRole('status')).not.toBeInTheDocument()

    // The acknowledged outcome stays hidden while the owner keeps it published.
    view.rerender(
      <ProviderLibraryProvider>
        <ChatMain
          compactions={compactions}
          session={session}
          responses={{ ...createResponseSlice(), response: { status: 'idle' } }}
        />
      </ProviderLibraryProvider>
    )
    expect(within(transcript).queryByRole('status')).not.toBeInTheDocument()
  })

  it('user views a measured request when it completes, then approximate input stays visible', () => {
    const { rerender } = render(
      <ProviderLibraryProvider>
        <ChatMain
          compactions={createCompactions()}
          session={createSessionSlice()}
          responses={{
            ...createResponseSlice(),
            response: { status: 'idle' },
            estimatedInputTokens: 1234
          }}
        />
      </ProviderLibraryProvider>
    )
    expect(screen.getByText('Approximate input: 1,234 tokens')).toBeVisible()
    rerender(
      <ProviderLibraryProvider>
        <ChatMain
          compactions={createCompactions()}
          session={createSessionSlice()}
          responses={createResponseSlice()}
        />
      </ProviderLibraryProvider>
    )
    expect(screen.queryByText(/Approximate input:/)).not.toBeInTheDocument()
  })
  beforeEach(async () => {
    // These scenarios verify layout and approvals after the lazy transcript is available.
    await import('./conversation/chat-message-list')
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
          getSkillCatalog: vi
            .fn<typeof window.api.chat.getSkillCatalog>()
            .mockResolvedValue({ skills: [], diagnostics: [] }),
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

  it('user reviews a pending command when messages are visible, then approval controls stay outside the transcript', async () => {
    const session = createSessionSlice()
    session.activeChat = new Chat<MicoUIMessage>({
      id: 'chat-approval',
      messages: [approvalMessage([pendingPermission])]
    })
    render(
      <ProviderLibraryProvider>
        <ChatMain
          compactions={createCompactions()}
          session={session}
          responses={createResponseSlice()}
        />
      </ProviderLibraryProvider>
    )
    const approval = screen.getByRole('group', { name: 'Pending tool approval' })
    expect(within(approval).getByRole('button', { name: 'Allow once' })).toBeVisible()
    const transcript = await screen.findByLabelText('Messages')
    expect(within(transcript).queryByRole('button', { name: 'Allow once' })).not.toBeInTheDocument()
    expect(within(transcript).queryByRole('button', { name: 'Deny' })).not.toBeInTheDocument()
  })

  it('user answers one of two requests when decisions stream back, then only the next pending request remains', async () => {
    const nextPermission = {
      ...pendingPermission,
      approvalId: '00000000-0000-4000-8000-000000000002',
      toolCallId: 'bash-next',
      input: { command: 'echo next-demo' }
    }
    const chat = new Chat<MicoUIMessage>({
      id: 'chat-queue',
      messages: [approvalMessage([pendingPermission, nextPermission])]
    })
    const session = { ...createSessionSlice(), activeChat: chat }
    render(
      <ProviderLibraryProvider>
        <ChatMain
          compactions={createCompactions()}
          session={session}
          responses={createResponseSlice()}
        />
      </ProviderLibraryProvider>
    )
    expect(
      within(screen.getByRole('group', { name: 'Pending tool approval' })).getByLabelText('Command')
    ).toHaveTextContent('echo approval-demo')
    await act(async () => {
      chat.messages = [
        approvalMessage([
          pendingPermission,
          nextPermission,
          { ...pendingPermission, state: 'approved' }
        ])
      ]
    })
    expect(
      within(screen.getByRole('group', { name: 'Pending tool approval' })).getByLabelText('Command')
    ).toHaveTextContent('echo next-demo')
    await act(async () => {
      chat.messages = [
        approvalMessage([
          { ...pendingPermission, state: 'approved' },
          { ...nextPermission, state: 'denied' }
        ])
      ]
    })
    expect(screen.queryByRole('group', { name: 'Pending tool approval' })).not.toBeInTheDocument()
  })

  it('user changes conversations when approval is pending, then only the active turn can show the card', () => {
    const session = {
      ...createSessionSlice(),
      activeChat: new Chat<MicoUIMessage>({
        id: 'chat-switch',
        messages: [approvalMessage([pendingPermission])]
      })
    }
    const responses = createResponseSlice()
    const { rerender } = render(
      <ProviderLibraryProvider>
        <ChatMain compactions={createCompactions()} session={session} responses={responses} />
      </ProviderLibraryProvider>
    )
    expect(screen.getByRole('group', { name: 'Pending tool approval' })).toBeVisible()
    rerender(
      <ProviderLibraryProvider>
        <ChatMain
          compactions={createCompactions()}
          session={{
            ...session,
            activeConversation: { id: 'conversation-2', title: 'Other chat' },
            activeChat: new Chat<MicoUIMessage>({ id: 'chat-other', messages: [] })
          }}
          responses={responses}
        />
      </ProviderLibraryProvider>
    )
    expect(screen.queryByRole('group', { name: 'Pending tool approval' })).not.toBeInTheDocument()
    rerender(
      <ProviderLibraryProvider>
        <ChatMain
          compactions={createCompactions()}
          session={session}
          responses={{ ...responses, response: { status: 'idle' } }}
        />
      </ProviderLibraryProvider>
    )
    expect(screen.queryByRole('group', { name: 'Pending tool approval' })).not.toBeInTheDocument()
  })

  it('user opens a bound conversation when a workspace exists, then its entry appears once at the top', async () => {
    const user = userEvent.setup()
    const session = createSessionSlice()
    session.activeProject = {
      id: 'project-1',
      name: 'Project one',
      rootPath: '/projects/one',
      isDefault: false
    }
    render(
      <ProviderLibraryProvider>
        <ChatMain
          compactions={createCompactions()}
          session={session}
          responses={createResponseSlice()}
        />
      </ProviderLibraryProvider>
    )
    const workspace = screen.getByRole('group', { name: 'Conversation workspace' })
    expect(
      within(workspace).getByRole('button', { name: 'Workspace: Project one (/projects/one)' })
    ).toBeVisible()
    expect(
      screen.getAllByRole('button', { name: 'Workspace: Project one (/projects/one)' })
    ).toHaveLength(1)
    await user.click(
      within(workspace).getByRole('button', { name: 'Workspace: Project one (/projects/one)' })
    )
    expect(screen.getByText('This workspace is set for the current conversation.')).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: 'Add workspace' })).not.toBeInTheDocument()
  })

  it('user keeps the stop control when a response reconnects, then it stays visible', () => {
    render(
      <ProviderLibraryProvider>
        <ChatMain
          compactions={createCompactions()}
          session={createSessionSlice()}
          responses={createResponseSlice()}
        />
      </ProviderLibraryProvider>
    )

    expect(screen.getByRole('button', { name: 'Stop response' })).toBeVisible()
  })

  it('user cannot open a saved conversation when loading fails, then a retry instruction is visible', () => {
    const session = createSessionSlice()
    session.activationError = 'Could not open this conversation. Select it again to retry.'
    render(
      <ProviderLibraryProvider>
        <ChatMain
          compactions={createCompactions()}
          session={session}
          responses={createResponseSlice()}
        />
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
        <ChatMain
          compactions={createCompactions()}
          session={session}
          responses={{ ...createResponseSlice(), response: { status: 'idle' } }}
        />
      </ProviderLibraryProvider>
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Select model' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Select model' }))
    await user.click(screen.getByRole('option', { name: 'Qwen 3 8B' }))

    await waitFor(() => expect(session.setSessionModelEntry).toHaveBeenCalledWith('ollama:qwen3'))
  })
})
