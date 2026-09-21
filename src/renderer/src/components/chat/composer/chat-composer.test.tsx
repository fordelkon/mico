import '@testing-library/jest-dom/vitest'

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import { ChatComposer } from './chat-composer'
import type { ChatDocumentPart } from '@shared/data/schemas/chat'
import type { WorkspaceProject } from '@shared/data/schemas/workspace'

const props = {
  focusKey: 0,
  mode: 'send' as const,
  onSend: async (): Promise<boolean> => true,
  onModelSelected: async (): Promise<void> => undefined,
  onStop: (): void => undefined,
  reasoningCapabilities: null,
  thinkingEffort: 'medium' as const,
  onThinkingEffortChange: (): void => undefined
}

const library = {
  configurations: [
    { provider: 'ollama' as const, baseUrl: 'http://localhost:11434', enabled: true }
  ],
  customProviders: [],
  models: [
    {
      id: 'ollama:qwen3',
      provider: 'ollama' as const,
      modelId: 'qwen3:8b',
      displayName: 'Qwen 3 8B',
      enabled: true
    }
  ],
  // SAFETY: getLibrary mocks reuse this library with the model selected or unselected.
  selectedModelId: 'ollama:qwen3' as string | null
}

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      attachments: {
        pickCodeDocuments: vi.fn<() => Promise<ChatDocumentPart[]>>().mockResolvedValue([])
      },
      providers: {
        getLibrary: vi.fn<() => Promise<typeof library>>().mockResolvedValue(library),
        selectModel: vi
          .fn<(modelId: string | null) => Promise<string | null>>()
          .mockResolvedValue('ollama:qwen3')
      }
    }
  })
})

function ComposerHarness({ mode = 'send' }: { mode?: 'send' | 'stop' }): React.JSX.Element {
  const [sentContent, setSentContent] = React.useState('')
  const [wasStopped, setWasStopped] = React.useState(false)

  return (
    <>
      <ChatComposer
        {...props}
        mode={mode}
        onSend={async ({ text }) => {
          setSentContent(text)
          return true
        }}
        onStop={() => setWasStopped(true)}
      />
      {sentContent && <output>{sentContent}</output>}
      {wasStopped && <output>Response stopped</output>}
    </>
  )
}

function ThinkingEffortHarness(): React.JSX.Element {
  const [selection, setSelection] = React.useState('')

  return (
    <>
      <ChatComposer
        {...props}
        reasoningCapabilities={{
          selectableEfforts: ['none', 'low', 'high'],
          defaultEffort: 'low'
        }}
        onThinkingEffortChange={setSelection}
      />
      {selection && <output>{`Thinking effort: ${selection}`}</output>}
    </>
  )
}

function WorkspaceComposerHarness({
  canAddProject = false
}: {
  canAddProject?: boolean
}): React.JSX.Element {
  const [projectLabel, setProjectLabel] = React.useState<string | null>(null)

  return (
    <ChatComposer
      {...props}
      canAddProject={canAddProject}
      onAddProject={async () => setProjectLabel('Project one')}
      onProjectSelected={(project) => setProjectLabel(project.name)}
      projectLabel={projectLabel}
      projects={[]}
    />
  )
}

function ModelSelectionHarness(): React.JSX.Element {
  const [wasRefreshed, setWasRefreshed] = React.useState(false)

  return (
    <>
      <ChatComposer {...props} onModelSelected={async () => setWasRefreshed(true)} />
      {wasRefreshed ? <output>Capabilities refreshed</output> : null}
    </>
  )
}

async function waitForModelButton(name: string | RegExp): Promise<void> {
  await waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled())
}

function renderWorkspaceComposer(
  overrides: Partial<React.ComponentProps<typeof ChatComposer>> = {}
): void {
  const { onProjectSelected, projects = [], ...rest } = overrides
  render(
    <ChatComposer
      {...props}
      canAddProject
      onAddProject={async (): Promise<void> => undefined}
      onProjectSelected={onProjectSelected ?? ((): void => undefined)}
      projects={projects}
      {...rest}
    />
  )
}

describe('ChatComposer', () => {
  it.each(['', 'Explain this file'])(
    'user sends documents with draft %j when pressing Send message, then attachments clear',
    async (text) => {
      const user = userEvent.setup()
      const document: ChatDocumentPart = { type: 'document', name: 'index.ts', text: 'export {}' }
      vi.mocked(window.api.attachments.pickCodeDocuments).mockResolvedValue([document])
      const onSend = vi.fn<() => Promise<boolean>>(async () => true)
      render(<ChatComposer {...props} onSend={onSend} />)
      await waitForModelButton('Qwen 3 8B')
      await user.click(screen.getByRole('button', { name: 'Add attachment' }))
      await user.click(screen.getByRole('menuitem', { name: 'Attach files' }))
      expect(await screen.findByText('index.ts')).toBeVisible()
      if (text) await user.type(screen.getByRole('textbox'), text)

      await user.click(screen.getByRole('button', { name: 'Send message' }))

      expect(onSend).toHaveBeenCalledWith({ text, documents: [document] })
      expect(screen.queryByText('index.ts')).toBeNull()
      expect(screen.getByRole('textbox')).toHaveValue('')
      expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
    }
  )

  async function renderPendingSend(): Promise<{
    acceptSend: (accepted: boolean) => void
    rejectSend: (reason: Error) => void
  }> {
    const user = userEvent.setup()
    vi.mocked(window.api.attachments.pickCodeDocuments).mockResolvedValue([
      { type: 'document', name: 'index.ts', text: 'export {}' }
    ])
    let resolveSend!: (accepted: boolean) => void
    let rejectSend!: (reason: Error) => void
    const onSend = vi.fn<() => Promise<boolean>>(
      () =>
        new Promise<boolean>((resolve, reject) => {
          resolveSend = resolve
          rejectSend = reject
        })
    )
    render(<ChatComposer {...props} onSend={onSend} />)
    await waitForModelButton('Qwen 3 8B')
    await user.click(screen.getByRole('button', { name: 'Add attachment' }))
    await user.click(screen.getByRole('menuitem', { name: 'Attach files' }))
    await screen.findByText('index.ts')
    await user.type(screen.getByRole('textbox'), 'Review this file')
    await user.click(screen.getByRole('button', { name: 'Send message' }))

    expect(screen.getByRole('textbox')).toHaveValue('Review this file')
    expect(screen.getByText('index.ts')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()

    return {
      acceptSend: (accepted: boolean): void => resolveSend(accepted),
      rejectSend: (reason: Error): void => rejectSend(reason)
    }
  }

  it('user keeps the draft and documents when the send is rejected, then the composer resets', async () => {
    const { acceptSend } = await renderPendingSend()

    await act(async () => acceptSend(false))

    expect(screen.getByRole('textbox')).toHaveValue('Review this file')
    expect(screen.getByText('index.ts')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('user sees an alert when the send fails, then the draft and documents remain', async () => {
    const { rejectSend } = await renderPendingSend()

    await act(async () => rejectSend(new Error('Could not create the conversation.')))

    expect(screen.getByRole('textbox')).toHaveValue('Review this file')
    expect(screen.getByText('index.ts')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not create the conversation.')
  })

  it.each(['stop', 'disabled'] as const)(
    'user cannot add attachments when the mode is %s, then the picker stays disabled',
    (mode) => {
      render(<ChatComposer {...props} mode={mode} />)
      expect(screen.getByRole('button', { name: 'Add attachment' })).toBeDisabled()
    }
  )

  it('user submits a draft when pressing Send message, then the sent content is shown', async () => {
    const user = userEvent.setup()
    render(<ComposerHarness />)

    await waitForModelButton('Qwen 3 8B')

    await user.type(screen.getByRole('textbox'), 'A multi-line draft.')

    await user.click(screen.getByRole('button', { name: 'Send message' }))

    expect(screen.getByText('A multi-line draft.')).toBeVisible()
  })

  it('user gets a workspace control when starting a new chat, then adding one binds it', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<WorkspaceComposerHarness />)

    expect(screen.queryByRole('button', { name: 'Choose workspace' })).toBeNull()

    rerender(<WorkspaceComposerHarness canAddProject />)

    await user.click(screen.getByRole('button', { name: 'Choose workspace' }))
    await user.click(screen.getByRole('button', { name: 'Add workspace' }))
    expect(screen.getByRole('button', { name: 'Workspace: Project one' })).toBeVisible()
  })

  it('user sees the bound workspace when one is already set, then no other option is offered', () => {
    renderWorkspaceComposer({ projectLabel: 'Project one', projectPath: '/projects/one' })

    expect(screen.queryByRole('button', { name: 'Choose workspace' })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Workspace: Project one (/projects/one)' })
    ).toBeVisible()
    expect(screen.getByText('Project one')).toBeVisible()
  })

  it('user selects the remembered workspace when opening the menu, then the parent receives it', async () => {
    const user = userEvent.setup()
    const onProjectSelected = vi.fn<(project: WorkspaceProject) => void>()
    renderWorkspaceComposer({
      onProjectSelected,
      projects: [
        { id: 'project-1', name: 'Project one', rootPath: '/projects/one', isDefault: false },
        { id: 'project-2', name: 'Project two', rootPath: '/projects/two', isDefault: false }
      ]
    })

    await user.click(screen.getByRole('button', { name: 'Choose workspace' }))
    expect(screen.getByText('/projects/two')).toBeVisible()
    const projectOption = screen.getByRole('option', { name: 'Project two' })
    await user.click(projectOption)

    expect(onProjectSelected).toHaveBeenCalledWith(expect.objectContaining({ id: 'project-2' }))
  })

  it('user sees only name or path matches when typing in the search box, then others drop out', async () => {
    const user = userEvent.setup()
    renderWorkspaceComposer({
      projects: [
        { id: 'project-1', name: 'Frontend', rootPath: '/projects/web', isDefault: false },
        { id: 'project-2', name: 'Backend', rootPath: '/projects/api', isDefault: false }
      ]
    })

    await user.click(screen.getByRole('button', { name: 'Choose workspace' }))
    const search = screen.getByPlaceholderText('Search workspaces')
    await user.type(search, 'api')

    expect(screen.getByRole('option', { name: 'Backend' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'Frontend' })).toBeNull()
  })

  it('user sees refreshed workspace names when the menu opens, then stale entries disappear', async () => {
    const user = userEvent.setup()
    function RefreshingWorkspaceComposer(): React.JSX.Element {
      const [projects, setProjects] = React.useState([
        { id: 'project-1', name: 'Old workspace name', rootPath: '/projects/one', isDefault: true },
        { id: 'project-2', name: 'Archived workspace', rootPath: '/projects/two', isDefault: false }
      ])

      return (
        <ChatComposer
          {...props}
          canAddProject
          onAddProject={async (): Promise<void> => undefined}
          onProjectSelected={() => undefined}
          onProjectsRefresh={async () =>
            setProjects([
              {
                id: 'project-1',
                name: 'Renamed default workspace',
                rootPath: '/projects/one',
                isDefault: true
              }
            ])
          }
          projects={projects}
        />
      )
    }

    render(<RefreshingWorkspaceComposer />)

    await user.click(screen.getByRole('button', { name: 'Choose workspace' }))

    expect(await screen.findByRole('option', { name: 'Renamed default workspace' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'Old workspace name' })).toBeNull()
    expect(screen.queryByRole('option', { name: 'Archived workspace' })).toBeNull()
  })

  it('user keeps the workspace menu when refreshing fails, then existing options remain', async () => {
    const user = userEvent.setup()
    renderWorkspaceComposer({
      onProjectsRefresh: async () => {
        throw new Error('Workspace refresh unavailable')
      },
      projects: [
        {
          id: 'project-1',
          name: 'Existing workspace',
          rootPath: '/projects/one',
          isDefault: true
        }
      ]
    })

    await user.click(screen.getByRole('button', { name: 'Choose workspace' }))

    expect(screen.getByRole('option', { name: 'Existing workspace' })).toBeVisible()
  })

  it('user cannot add a workspace when a conversation has started, then the control is absent', async () => {
    const user = userEvent.setup()
    renderWorkspaceComposer({
      canAddProject: false,
      projectLabel: 'Project one',
      projectPath: '/projects/one'
    })

    await user.click(screen.getByRole('button', { name: 'Workspace: Project one (/projects/one)' }))

    expect(screen.getByText('This workspace is set for the current conversation.')).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: 'Add workspace' })).toBeNull()
  })

  it('user sees rotating suggestions when the composer is blank, then focusing shows the placeholder', async () => {
    vi.useFakeTimers()
    try {
      render(<ChatComposer {...props} canAddProject />)

      expect(screen.getByText('Ask Mico to explain a concept…')).toBeVisible()

      await act(() => vi.advanceTimersByTime(4_500))

      expect(screen.getByText('Plan a project step by step…')).toBeVisible()

      fireEvent.focus(screen.getByRole('textbox'))

      expect(screen.queryByText('Plan a project step by step…')).toBeNull()
      expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Ask Mico anything…')
    } finally {
      vi.useRealTimers()
    }
  })

  it('user sees a static placeholder when reduced motion is preferred, then no suggestions appear', () => {
    const originalMatchMedia = window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (): MediaQueryList => ({
        matches: true,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false
      })
    })

    try {
      render(<ChatComposer {...props} canAddProject />)

      expect(screen.queryByText('Ask Mico to explain a concept…')).toBeNull()
      expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Ask Mico anything…')
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: originalMatchMedia
      })
    }
  })

  it('user focuses the draft when typing outside editable controls, then focus lands in the textarea', () => {
    render(
      <>
        <button type="button">Conversation action</button>
        <ChatComposer {...props} />
      </>
    )

    const textarea = screen.getByRole('textbox')
    screen.getByRole('button', { name: 'Conversation action' }).focus()

    fireEvent.keyDown(window, { key: 'h' })

    expect(textarea).toHaveFocus()
  })

  it('user keeps the draft unfocused when pressing a non-text key, then the textarea ignores it', () => {
    render(<ChatComposer {...props} />)

    fireEvent.keyDown(window, { key: 'ArrowDown' })

    expect(screen.getByRole('textbox')).not.toHaveFocus()
  })

  it('user sees the textarea shrink back when sending, then the draft returns to one line', async () => {
    const user = userEvent.setup()
    render(<ComposerHarness />)

    await waitForModelButton('Qwen 3 8B')

    // SAFETY: ChatComposer's only textbox is its textarea draft control.
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      get: () => (textarea.value ? 96 : 56)
    })

    fireEvent.change(textarea, { target: { value: 'A multi-line draft.' } })

    expect(textarea).toHaveStyle({ height: '96px' })

    await user.click(screen.getByRole('button', { name: 'Send message' }))

    expect(textarea).toHaveStyle({ height: '56px' })
  })

  it('user stops the response when pressing Stop response, then the stop callback runs', async () => {
    const user = userEvent.setup()
    render(<ComposerHarness mode="stop" />)

    await user.click(screen.getByRole('button', { name: 'Stop response' }))

    expect(screen.getByText('Response stopped')).toBeVisible()
  })

  it('user cannot send when no model is enabled, then the send control stays disabled', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        providers: {
          getLibrary: vi
            .fn<() => Promise<typeof library>>()
            .mockResolvedValue({ ...library, selectedModelId: null }),
          selectModel: vi
            .fn<(modelId: string | null) => Promise<string | null>>()
            .mockResolvedValue('ollama:qwen3')
        }
      }
    })
    render(<ChatComposer {...props} />)

    await waitForModelButton('Select model')
    await user.type(screen.getByRole('textbox'), 'Hello')

    expect(
      screen.getByRole('button', { name: 'Select an enabled model to send messages' })
    ).toBeDisabled()
  })

  it('user selects a model in the composer when picking one, then the parent is notified', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        providers: {
          // SAFETY: the provider library is served with the model unselected, then selected.
          getLibrary: vi
            .fn<() => Promise<typeof library>>()
            .mockResolvedValueOnce({ ...library, selectedModelId: null })
            .mockResolvedValue(library),
          selectModel: vi
            .fn<(modelId: string | null) => Promise<string | null>>()
            .mockResolvedValue('ollama:qwen3')
        }
      }
    })

    render(<ModelSelectionHarness />)

    await waitForModelButton('Select model')
    await user.click(screen.getByRole('button', { name: 'Select model' }))
    await user.click(screen.getByRole('option', { name: 'Qwen 3 8B' }))

    expect(await screen.findByText('Capabilities refreshed')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Qwen 3 8B' })).toBeVisible()
  })

  it('user gets no thinking menu when the model has nothing adjustable, then it is absent', () => {
    render(<ChatComposer {...props} />)

    expect(screen.queryByRole('button', { name: 'Thinking effort' })).toBeNull()
  })

  it('user sees only advertised efforts when opening the thinking menu, then the rest are missing', async () => {
    const user = userEvent.setup()
    render(<ThinkingEffortHarness />)

    await user.click(screen.getByRole('button', { name: /^Thinking effort:/ }))

    expect(screen.queryByRole('menuitemradio', { name: 'Default' })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: /^Off/ })).toBeVisible()
    expect(screen.queryByRole('menuitemradio', { name: /^Medium/ })).toBeNull()
  })

  it('user commits the chosen effort when selecting an option, then the parent receives it', async () => {
    const user = userEvent.setup()
    render(<ThinkingEffortHarness />)

    await user.click(screen.getByRole('button', { name: /^Thinking effort:/ }))

    await user.click(screen.getByRole('menuitemradio', { name: /^High/ }))

    expect(screen.getByText('Thinking effort: high')).toBeVisible()
  })

  it.each(['stop', 'disabled'] as const)(
    'user cannot adjust thinking when the mode is %s, then the menu stays disabled',
    (mode) => {
      render(
        <ChatComposer
          {...props}
          mode={mode}
          reasoningCapabilities={{
            selectableEfforts: ['none', 'medium'],
            defaultEffort: 'medium'
          }}
        />
      )

      expect(screen.getByRole('button', { name: /^Thinking effort:/ })).toBeDisabled()
    }
  )
})
