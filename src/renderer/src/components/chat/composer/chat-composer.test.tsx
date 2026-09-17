import '@testing-library/jest-dom/vitest'

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import { ChatComposer } from './chat-composer'
import type { ChatDocumentPart } from '@shared/data/schemas/chat'

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
  selectedModelId: 'ollama:qwen3'
}

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      attachments: { pickCodeDocuments: vi.fn().mockResolvedValue([]) },
      providers: {
        getLibrary: vi.fn().mockResolvedValue(library),
        selectModel: vi.fn().mockResolvedValue('ollama:qwen3')
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

describe('ChatComposer', () => {
  it.each(['', 'Explain this file'])(
    'sends documents with draft %j and clears them after the callback',
    async (text) => {
      const user = userEvent.setup()
      const document: ChatDocumentPart = { type: 'document', name: 'index.ts', text: 'export {}' }
      vi.mocked(window.api.attachments.pickCodeDocuments).mockResolvedValue([document])
      const onSend = vi.fn(async () => true)
      render(<ChatComposer {...props} onSend={onSend} />)
      await waitFor(() => expect(screen.getByRole('button', { name: 'Qwen 3 8B' })).toBeEnabled())
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

  it.each(['busy', 'failed'] as const)(
    'retains the draft and documents when sending is %s',
    async (outcome) => {
      const user = userEvent.setup()
      vi.mocked(window.api.attachments.pickCodeDocuments).mockResolvedValue([
        { type: 'document', name: 'index.ts', text: 'export {}' }
      ])
      let rejectSend: ((reason: Error) => void) | undefined
      let acceptSend: ((accepted: boolean) => void) | undefined
      const onSend = vi.fn(
        () =>
          new Promise<boolean>((resolve, reject) => {
            acceptSend = resolve
            rejectSend = reject
          })
      )
      render(<ChatComposer {...props} onSend={onSend} />)
      await waitFor(() => expect(screen.getByRole('button', { name: 'Qwen 3 8B' })).toBeEnabled())
      await user.click(screen.getByRole('button', { name: 'Add attachment' }))
      await user.click(screen.getByRole('menuitem', { name: 'Attach files' }))
      await screen.findByText('index.ts')
      await user.type(screen.getByRole('textbox'), 'Review this file')
      await user.click(screen.getByRole('button', { name: 'Send message' }))

      expect(screen.getByRole('textbox')).toHaveValue('Review this file')
      expect(screen.getByText('index.ts')).toBeVisible()
      expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()

      await act(async () => {
        if (outcome === 'failed') rejectSend?.(new Error('Could not create the conversation.'))
        else acceptSend?.(false)
      })

      expect(screen.getByRole('textbox')).toHaveValue('Review this file')
      expect(screen.getByText('index.ts')).toBeVisible()
      expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()
      if (outcome === 'failed')
        expect(screen.getByRole('alert')).toHaveTextContent('Could not create the conversation.')
    }
  )

  it.each(['stop', 'disabled'] as const)('disables attachment selection in %s mode', (mode) => {
    render(<ChatComposer {...props} mode={mode} />)
    expect(screen.getByRole('button', { name: 'Add attachment' })).toBeDisabled()
  })

  it('submits a non-empty draft', async () => {
    const user = userEvent.setup()
    render(<ComposerHarness />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Qwen 3 8B' })).toBeEnabled())

    await user.type(screen.getByRole('textbox'), 'A multi-line draft.')

    await user.click(screen.getByRole('button', { name: 'Send message' }))

    expect(screen.getByText('A multi-line draft.')).toBeVisible()
  })

  it('offers workspace selection as an icon control only while starting a new chat', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<WorkspaceComposerHarness />)

    expect(screen.queryByRole('button', { name: 'Choose workspace' })).toBeNull()

    rerender(<WorkspaceComposerHarness canAddProject />)

    await user.click(screen.getByRole('button', { name: 'Choose workspace' }))
    await user.click(screen.getByRole('button', { name: 'Add workspace' }))
    expect(screen.getByRole('button', { name: 'Workspace: Project one' })).toBeVisible()
  })

  it('shows the bound workspace path without allowing another workspace selection', () => {
    render(
      <ChatComposer
        {...props}
        canAddProject
        onAddProject={async (): Promise<void> => undefined}
        projectLabel="Project one"
        projectPath="/projects/one"
      />
    )

    expect(screen.queryByRole('button', { name: 'Choose workspace' })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Workspace: Project one (/projects/one)' })
    ).toBeVisible()
    expect(screen.getByText('Project one')).toBeVisible()
  })

  it('lets a new chat select a remembered workspace from the project menu', async () => {
    const user = userEvent.setup()
    const onProjectSelected = vi.fn()
    render(
      <ChatComposer
        {...props}
        canAddProject
        onAddProject={async (): Promise<void> => undefined}
        onProjectSelected={onProjectSelected}
        projects={[
          { id: 'project-1', name: 'Project one', rootPath: '/projects/one', isDefault: false },
          { id: 'project-2', name: 'Project two', rootPath: '/projects/two', isDefault: false }
        ]}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Choose workspace' }))
    expect(screen.getByText('/projects/two')).toBeVisible()
    const projectOption = screen.getByRole('option', { name: 'Project two' })
    await user.click(projectOption)

    expect(onProjectSelected).toHaveBeenCalledWith(expect.objectContaining({ id: 'project-2' }))
  })

  it('filters new-chat workspaces by name and path', async () => {
    const user = userEvent.setup()
    render(
      <ChatComposer
        {...props}
        canAddProject
        onAddProject={async (): Promise<void> => undefined}
        onProjectSelected={() => undefined}
        projects={[
          { id: 'project-1', name: 'Frontend', rootPath: '/projects/web', isDefault: false },
          { id: 'project-2', name: 'Backend', rootPath: '/projects/api', isDefault: false }
        ]}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Choose workspace' }))
    const search = screen.getByPlaceholderText('Search workspaces')
    await user.type(search, 'api')

    expect(screen.getByRole('option', { name: 'Backend' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'Frontend' })).toBeNull()
  })

  it('refreshes workspace names when the project menu opens', async () => {
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

  it('keeps the workspace menu usable when refreshing its list fails', async () => {
    const user = userEvent.setup()
    render(
      <ChatComposer
        {...props}
        canAddProject
        onAddProject={async (): Promise<void> => undefined}
        onProjectSelected={() => undefined}
        onProjectsRefresh={async () => {
          throw new Error('Workspace refresh unavailable')
        }}
        projects={[
          {
            id: 'project-1',
            name: 'Existing workspace',
            rootPath: '/projects/one',
            isDefault: true
          }
        ]}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Choose workspace' }))

    expect(screen.getByRole('option', { name: 'Existing workspace' })).toBeVisible()
  })

  it('explains that a workspace is locked after a conversation starts', async () => {
    const user = userEvent.setup()
    render(
      <ChatComposer
        {...props}
        canAddProject={false}
        projectLabel="Project one"
        projectPath="/projects/one"
      />
    )

    await user.click(screen.getByRole('button', { name: 'Workspace: Project one (/projects/one)' }))

    expect(screen.getByText('This workspace is set for the current conversation.')).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: 'Add workspace' })).toBeNull()
  })

  it('rotates suggestions only for an unfocused blank composer in a new chat', async () => {
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

  it('keeps the placeholder static when reduced motion is preferred', () => {
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

  it('focuses the draft when typing outside an editable control', () => {
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

  it('does not focus the draft for a non-text key', () => {
    render(<ChatComposer {...props} />)

    fireEvent.keyDown(window, { key: 'ArrowDown' })

    expect(screen.getByRole('textbox')).not.toHaveFocus()
  })

  it('restores a sent draft to its single-line height', async () => {
    const user = userEvent.setup()
    render(<ComposerHarness />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Qwen 3 8B' })).toBeEnabled())

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

  it('lets a user stop an in-progress response', async () => {
    const user = userEvent.setup()
    render(<ComposerHarness mode="stop" />)

    await user.click(screen.getByRole('button', { name: 'Stop response' }))

    expect(screen.getByText('Response stopped')).toBeVisible()
  })

  it('prevents sending a drafted message until an enabled model is selected', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        providers: {
          getLibrary: vi.fn().mockResolvedValue({ ...library, selectedModelId: null }),
          selectModel: vi.fn().mockResolvedValue('ollama:qwen3')
        }
      }
    })
    render(<ChatComposer {...props} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Select model' })).toBeEnabled())
    await user.type(screen.getByRole('textbox'), 'Hello')

    expect(
      screen.getByRole('button', { name: 'Select an enabled model to send messages' })
    ).toBeDisabled()
  })

  it('owns model selection and notifies its parent after a model is selected', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        providers: {
          getLibrary: vi
            .fn()
            .mockResolvedValueOnce({
              configurations: [
                { provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: true }
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
            })
            .mockResolvedValue({
              configurations: [
                { provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: true }
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
              selectedModelId: 'ollama:qwen3'
            }),
          selectModel: vi.fn().mockResolvedValue('ollama:qwen3')
        }
      }
    })

    render(<ModelSelectionHarness />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Select model' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Select model' }))
    await user.click(screen.getByRole('option', { name: 'Qwen 3 8B' }))

    expect(await screen.findByText('Capabilities refreshed')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Qwen 3 8B' })).toBeVisible()
  })

  it('does not render a thinking menu without adjustable capabilities', () => {
    render(<ChatComposer {...props} />)

    expect(screen.queryByRole('button', { name: 'Thinking effort' })).toBeNull()
  })

  it('renders only advertised thinking-effort options', async () => {
    const user = userEvent.setup()
    render(<ThinkingEffortHarness />)

    await user.click(screen.getByRole('button', { name: /^Thinking effort:/ }))

    expect(screen.queryByRole('menuitemradio', { name: 'Default' })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: /^Off/ })).toBeVisible()
    expect(screen.queryByRole('menuitemradio', { name: /^Medium/ })).toBeNull()
  })

  it('commits the selected thinking effort', async () => {
    const user = userEvent.setup()
    render(<ThinkingEffortHarness />)

    await user.click(screen.getByRole('button', { name: /^Thinking effort:/ }))

    await user.click(screen.getByRole('menuitemradio', { name: /^High/ }))

    expect(screen.getByText('Thinking effort: high')).toBeVisible()
  })

  it.each(['stop', 'disabled'] as const)(
    'disables the thinking menu while composer mode is %s',
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
