import '@testing-library/jest-dom/vitest'

import { ProviderLibraryProvider } from '@renderer/components/settings/providers/provider-library'
import type { PermissionMode } from '@shared/ai/permissions'
import type { ChatDocumentPart } from '@shared/data/schemas/chat'
import type { WorkspaceProject } from '@shared/data/schemas/workspace'
import type { ChatAPI } from '@shared/ipc/schemas/chat'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatComposer } from './chat-composer'
import { chatComposerDrafts, composerDraftKey } from './draft/composer-drafts'
import { stubBrowserEditCommands } from './test-helpers/browser-edit-commands'

const skillCatalog = {
  skills: [
    {
      id: 'review',
      name: 'review',
      description: 'Review the changes.',
      source: 'project-agents' as const,
      userInvocable: true,
      disableModelInvocation: false
    },
    {
      id: 'manual',
      name: 'manual',
      description: 'Follow manual steps.',
      source: 'user-claude' as const,
      userInvocable: true,
      disableModelInvocation: true
    },
    {
      id: 'hidden',
      name: 'hidden',
      description: 'Internal helper.',
      source: 'user-agents' as const,
      userInvocable: false,
      disableModelInvocation: false
    }
  ],
  diagnostics: []
}

const props = {
  focusKey: 0,
  projectId: 'project-1',
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
  // The draft store outlives single renders; isolate every test from the last.
  for (const key of [
    composerDraftKey(null),
    composerDraftKey('conversation-1'),
    composerDraftKey('conversation-2')
  ]) {
    chatComposerDrafts.clearDraft(key)
  }
  // Completion and atomic token edits run as real browser edit transactions;
  // jsdom has no execCommand, so the document seam is stubbed here.
  stubBrowserEditCommands()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      chat: {
        getSkillCatalog: vi.fn<ChatAPI['getSkillCatalog']>().mockResolvedValue(skillCatalog)
      },
      attachments: {
        pickCodeDocuments: vi.fn<() => Promise<ChatDocumentPart[]>>().mockResolvedValue([])
      },
      providers: {
        getLibrary: vi.fn<() => Promise<typeof library>>().mockResolvedValue(library),
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

// The composer reads the provider catalog from the app-wide context, so every
// render mounts the provider; its initial load uses the mocked getLibrary.
function renderWithLibrary(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<ProviderLibraryProvider>{ui}</ProviderLibraryProvider>)
}
function rerenderWithLibrary(
  rerender: (ui: React.ReactElement) => void,
  ui: React.ReactElement
): void {
  rerender(<ProviderLibraryProvider>{ui}</ProviderLibraryProvider>)
}

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
  renderWithLibrary(
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
  it.each(['Tab', 'Enter'])(
    'user completes /compact when pressing %s, then submission runs locally',
    async (key) => {
      const user = userEvent.setup()
      const onCompact = vi.fn<() => void>()
      const onSend = vi
        .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
        .mockResolvedValue(true)
      renderWithLibrary(<ChatComposer {...props} onCompact={onCompact} onSend={onSend} />)
      await user.type(screen.getByRole('textbox'), '/')
      const command = await screen.findByRole('option', { name: /Compact context/ })
      expect(command).toHaveTextContent('/compact')
      expect(command).toHaveTextContent('Summarize this conversation to free context space.')
      expect(screen.queryByRole('option', { name: /review/ })).not.toBeInTheDocument()
      await user.keyboard(`{${key}}`)
      expect(screen.getByRole('textbox')).toHaveValue('/compact ')
      expect(onCompact).not.toHaveBeenCalled()
      await user.keyboard('{Enter}')
      expect(onCompact).toHaveBeenCalledOnce()
      expect(onSend).not.toHaveBeenCalled()
      expect(screen.getByRole('textbox')).toHaveValue('')
    }
  )

  it('user submits /compact when no model or workspace is selected, then it still runs locally', async () => {
    const user = userEvent.setup()
    vi.mocked(window.api.providers.getLibrary).mockResolvedValue({
      ...library,
      enabledProviderIds: ['ollama'],
      selectedProviderId: 'ollama',
      selectedModelId: null
    })
    const onCompact = vi.fn<() => void>()
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    renderWithLibrary(
      <ChatComposer {...props} projectId={null} onCompact={onCompact} onSend={onSend} />
    )
    await waitForModelButton('Select model')
    await user.type(screen.getByRole('textbox'), '/compact')
    expect(await screen.findByRole('option', { name: /Compact context/ })).toBeVisible()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect(onCompact).toHaveBeenCalledOnce()
    expect(onSend).not.toHaveBeenCalled()
  })

  it.each(['loading', 'error'] as const)(
    'user opens /compact when skills are %s, then the built-in command remains usable',
    async (status) => {
      const user = userEvent.setup()
      const catalog = Promise.withResolvers<Awaited<ReturnType<ChatAPI['getSkillCatalog']>>>()
      vi.mocked(window.api.chat.getSkillCatalog).mockReturnValue(catalog.promise)
      const onCompact = vi.fn<() => void>()
      renderWithLibrary(<ChatComposer {...props} onCompact={onCompact} />)
      if (status === 'error') {
        await act(async () => catalog.reject(new Error('Skill discovery unavailable')))
      }
      await user.type(screen.getByRole('textbox'), '/comp')
      await user.click(await screen.findByRole('option', { name: /Compact context/ }))
      expect(screen.getByRole('textbox')).toHaveValue('/compact ')
      expect(screen.getByText('/compact', { selector: '[data-token-kind="command"]' })).toHaveClass(
        'text-brand'
      )
      await user.keyboard('{Enter}')
      expect(onCompact).toHaveBeenCalledOnce()
      await act(async () => catalog.resolve(skillCatalog))
    }
  )

  it('user submits /compact when starting a new chat, then guidance keeps the draft unsent', async () => {
    const user = userEvent.setup()
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    renderWithLibrary(<ChatComposer {...props} onSend={onSend} />)
    await user.type(screen.getByRole('textbox'), '/compact')
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose an existing conversation')
    expect(screen.getByRole('textbox')).toHaveValue('/compact')
    expect(onSend).not.toHaveBeenCalled()
  })

  it.each(['stop', 'disabled'] as const)(
    'user has a /compact draft when mode is %s, then dispatch waits',
    async (mode) => {
      const user = userEvent.setup()
      const onCompact = vi.fn<() => void>()
      const { rerender } = renderWithLibrary(<ChatComposer {...props} onCompact={onCompact} />)
      await user.type(screen.getByRole('textbox'), '/compact')
      rerenderWithLibrary(rerender, <ChatComposer {...props} mode={mode} onCompact={onCompact} />)
      expect(screen.queryByRole('option', { name: /Compact context/ })).not.toBeInTheDocument()
      expect(screen.getByRole('textbox').hasAttribute('disabled')).toBe(mode === 'disabled')
      await user.keyboard('{Enter}')
      expect(onCompact).not.toHaveBeenCalled()
      expect(screen.getByRole('textbox')).toHaveValue(mode === 'stop' ? '/compact\n' : '/compact')
    }
  )

  it('user presses Enter when streaming, then the draft gains a newline without sending or stopping', async () => {
    const user = userEvent.setup()
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    const onStop = vi.fn<() => void>()
    renderWithLibrary(<ChatComposer {...props} mode="stop" onSend={onSend} onStop={onStop} />)

    await user.type(screen.getByRole('textbox'), 'First line')
    await user.keyboard('{Enter}Second line')

    expect(screen.getByRole('textbox')).toHaveValue('First line\nSecond line')
    expect(onStop).not.toHaveBeenCalled()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('user presses Enter when the menu has no matching entry, then the half-typed token stays unsent', async () => {
    const user = userEvent.setup()
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    renderWithLibrary(<ChatComposer {...props} onCompact={() => undefined} onSend={onSend} />)
    await waitForModelButton('Qwen 3 8B')

    await user.type(screen.getByRole('textbox'), '/unknown')
    expect(await screen.findByRole('listbox', { name: 'Commands and skills' })).toBeVisible()
    await user.keyboard('{Enter}')

    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox')).toHaveValue('/unknown')
  })

  it('user presses Ctrl+Enter when the menu is open, then native editing stays available', async () => {
    const user = userEvent.setup()
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    renderWithLibrary(<ChatComposer {...props} onSend={onSend} />)
    await waitForModelButton('Qwen 3 8B')
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')

    await user.type(textarea, '$')
    expect(await screen.findByRole('option', { name: /review/ })).toBeVisible()
    const ctrlEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    })
    textarea.dispatchEvent(ctrlEnter)

    expect(ctrlEnter.defaultPrevented).toBe(false)
    expect(textarea).toHaveValue('$')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('user cannot change the model when the composer is not sendable, then the selector stays disabled', async () => {
    renderWithLibrary(<ChatComposer {...props} mode="stop" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Qwen 3 8B' })).toBeDisabled())
  })

  it('user presses Enter twice when a send is pending, then only one message goes out', async () => {
    const user = userEvent.setup()
    let resolveSend!: (accepted: boolean) => void
    const onSend = vi.fn<React.ComponentProps<typeof ChatComposer>['onSend']>(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSend = resolve
        })
    )
    renderWithLibrary(<ChatComposer {...props} onSend={onSend} />)
    await waitForModelButton('Qwen 3 8B')
    await user.type(screen.getByRole('textbox'), 'Hello there')
    await user.keyboard('{Enter}')
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')

    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSend).toHaveBeenCalledTimes(1)
    await act(async () => resolveSend(true))
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('user edits the draft when compaction has failed, then the stale guidance clears', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ChatComposer {...props} />)
    await user.type(screen.getByRole('textbox'), '/compact')
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose an existing conversation')

    await user.type(screen.getByRole('textbox'), 'x')

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('user sends a draft when pressing Enter, then the message is submitted and cleared', async () => {
    const user = userEvent.setup()
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    renderWithLibrary(<ChatComposer {...props} onSend={onSend} />)
    await waitForModelButton('Qwen 3 8B')

    await user.type(screen.getByRole('textbox'), 'Hello')
    await user.keyboard('{Enter}')

    expect(onSend).toHaveBeenCalledWith({ text: 'Hello', documents: [] })
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('user drafts /compact when typing arguments, then only the command is highlighted', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ChatComposer {...props} />)

    await user.type(screen.getByRole('textbox'), '/compact hello')

    const highlight = screen.getByText('/compact')
    expect(highlight).toHaveClass('text-brand')
    expect(highlight.closest('[aria-hidden="true"]')).toHaveTextContent('/compact hello')
  })

  it('user mentions a known skill mid-message when drafting, then the body word stays plain', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ChatComposer {...props} />)

    await user.type(screen.getByRole('textbox'), 'use $review here')

    expect(screen.queryByText('$review', { selector: '[data-token-kind]' })).toBeNull()
    expect(screen.getByText('use $review here', { selector: '[aria-hidden="true"]' })).toBeVisible()
  })

  it('user drafts plain words when no token matches, then the mirror still shows the full text', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ChatComposer {...props} />)

    await user.type(screen.getByRole('textbox'), 'plain words only')

    const mirror = screen.getByText('plain words only', { selector: '[aria-hidden="true"]' })
    expect(mirror.querySelector('[data-token-kind]')).toBeNull()
  })

  it('user composes text with an IME when a token is drafted, then the native glyphs replace the mirror', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ChatComposer {...props} />)
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')
    await user.type(textarea, '/compact hello')

    fireEvent.compositionStart(textarea)

    expect(textarea).toHaveAttribute('data-composing', 'true')
    expect(
      screen.getByText('/compact', { selector: '[data-token-kind]' }).closest('div')
    ).toHaveStyle({ visibility: 'hidden' })

    fireEvent.compositionEnd(textarea)

    expect(textarea).not.toHaveAttribute('data-composing')
    expect(
      screen.getByText('/compact', { selector: '[data-token-kind]' }).closest('div')
    ).not.toHaveStyle({ visibility: 'hidden' })
  })

  it('user sends $compact when a skill shares the built-in name, then its identity stays explicit', async () => {
    const user = userEvent.setup()
    vi.mocked(window.api.chat.getSkillCatalog).mockResolvedValue({
      ...skillCatalog,
      skills: [{ ...skillCatalog.skills[0], id: 'compact-skill', name: 'compact' }]
    })
    const onCompact = vi.fn<() => void>()
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    renderWithLibrary(<ChatComposer {...props} onCompact={onCompact} onSend={onSend} />)
    await waitForModelButton('Qwen 3 8B')
    await user.type(screen.getByRole('textbox'), '$comp')
    expect(await screen.findByRole('option', { name: /compact/ })).toBeVisible()
    expect(screen.queryByRole('option', { name: /Compact context/ })).not.toBeInTheDocument()
    await user.keyboard('{Tab}')
    await user.type(screen.getByRole('textbox'), 'notes')
    await user.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledWith({
      text: '$compact notes',
      documents: [],
      skillInvocation: { skillId: 'compact-skill', name: 'compact', arguments: 'notes' }
    })
    expect(onCompact).not.toHaveBeenCalled()
  })

  it('user sends an unknown bare slash when submitting, then it remains a normal message', async () => {
    const user = userEvent.setup()
    const onCompact = vi.fn<() => void>()
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    renderWithLibrary(<ChatComposer {...props} onCompact={onCompact} onSend={onSend} />)
    await waitForModelButton('Qwen 3 8B')
    await user.type(screen.getByRole('textbox'), '/unknown notes')
    await user.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledWith({ text: '/unknown notes', documents: [] })
    expect(onCompact).not.toHaveBeenCalled()
  })

  it('user submits /compact with arguments when attachments exist, then all input is kept for correction', async () => {
    const user = userEvent.setup()
    const document: ChatDocumentPart = { type: 'document', name: 'index.ts', text: 'export {}' }
    vi.mocked(window.api.attachments.pickCodeDocuments).mockResolvedValue([document])
    const onCompact = vi.fn<() => void>()
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    renderWithLibrary(<ChatComposer {...props} onCompact={onCompact} onSend={onSend} />)
    await waitForModelButton('Qwen 3 8B')
    await user.click(screen.getByRole('button', { name: 'Add attachment' }))
    await user.click(screen.getByRole('menuitem', { name: 'Attach files' }))
    await screen.findByText('index.ts')
    await user.type(screen.getByRole('textbox'), '/compact notes')
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('takes no arguments')
    expect(screen.getByRole('textbox')).toHaveValue('/compact notes')
    expect(screen.getByText('index.ts')).toBeVisible()
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), '/compact ')
    await user.keyboard('{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('does not support attachments')
    expect(screen.getByRole('textbox')).toHaveValue('/compact ')
    expect(screen.getByText('index.ts')).toBeVisible()
    expect(onCompact).not.toHaveBeenCalled()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('user opens skill completion without a workspace when typing $, then workspace guidance appears', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ChatComposer {...props} projectId={null} />)
    await user.type(screen.getByRole('textbox'), '$')
    expect(await screen.findByText('Choose a workspace to use skills.')).toBeVisible()
    expect(window.api.chat.getSkillCatalog).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox')).toHaveValue('$')
  })
  it('user switches projects when a catalog is pending, then old skills stay unavailable', async () => {
    const user = userEvent.setup()
    let resolveOld!: (catalog: typeof skillCatalog) => void
    vi.mocked(window.api.chat.getSkillCatalog)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve
          })
      )
      .mockResolvedValueOnce({ ...skillCatalog, skills: [skillCatalog.skills[1]] })
    const { rerender } = renderWithLibrary(<ChatComposer {...props} projectId="old" />)
    await waitForModelButton('Qwen 3 8B')
    await user.type(screen.getByRole('textbox'), '$')
    rerenderWithLibrary(rerender, <ChatComposer {...props} projectId="new" />)
    expect(await screen.findByRole('option', { name: /manual/ })).toBeVisible()
    await act(async () => resolveOld(skillCatalog))
    expect(screen.queryByRole('option', { name: /review/ })).toBeNull()
    expect(screen.getByRole('textbox')).toHaveValue('$')
  })

  it('user retries a failed catalog when choosing skills, then the draft and choices return', async () => {
    const user = userEvent.setup()
    vi.mocked(window.api.chat.getSkillCatalog)
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue(skillCatalog)
    renderWithLibrary(<ChatComposer {...props} />)
    await user.type(screen.getByRole('textbox'), '$')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load skills')
    await user.click(screen.getByRole('button', { name: 'Retry skills' }))
    expect(await screen.findByRole('option', { name: /review/ })).toBeVisible()
    expect(screen.getByRole('textbox')).toHaveValue('$')
  })
  it('user opens skills with warnings when discovery succeeds, then details expand and retry refreshes', async () => {
    const user = userEvent.setup()
    const diagnostics = Array.from({ length: 40 }, (_, index) => ({
      path: `/projects/mico/.agents/skills/broken-${index}/SKILL.md`,
      source: 'project-agents' as const,
      message: `Invalid skill metadata ${index}.`
    }))
    vi.mocked(window.api.chat.getSkillCatalog)
      .mockResolvedValueOnce({ ...skillCatalog, diagnostics })
      .mockResolvedValueOnce({ ...skillCatalog, skills: [skillCatalog.skills[1]] })
    renderWithLibrary(<ChatComposer {...props} />)
    await user.type(screen.getByRole('textbox'), '$')

    expect(await screen.findByRole('option', { name: /review/ })).toBeVisible()
    const summary = screen.getByText('40 skill discovery warnings', { exact: true })
    expect(summary).toBeVisible()
    expect(screen.getByText(diagnostics[0].message)).not.toBeVisible()
    expect(screen.getByRole('button', { name: 'Retry skills' })).toBeVisible()

    summary.focus()
    await user.keyboard(' ')
    expect(summary).toHaveFocus()
    // jsdom does not implement native summary keyboard activation.
    await user.click(summary)

    expect(screen.getByText(diagnostics[0].path, { exact: true })).toBeVisible()
    expect(screen.getByText(diagnostics[0].message, { exact: true })).toBeVisible()
    expect(screen.getByText(diagnostics[39].path, { exact: true })).toBeVisible()
    expect(screen.getByText(diagnostics[39].message, { exact: true })).toBeVisible()
    await user.click(summary)
    expect(screen.getByText(diagnostics[0].message)).not.toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Retry skills' }))

    expect(await screen.findByRole('option', { name: /manual/ })).toBeVisible()
    expect(screen.queryByRole('option', { name: /review/ })).toBeNull()
    expect(screen.queryByText('40 skill discovery warnings', { exact: true })).toBeNull()
    expect(screen.getByRole('textbox')).toHaveValue('$')
  })

  it('user hovers another skill when browsing the skill menu, then only that skill is selected', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ChatComposer {...props} />)
    await user.type(screen.getByRole('textbox'), '$')
    const review = await screen.findByRole('option', { name: /review/ })
    const manual = screen.getByRole('option', { name: /manual/ })
    expect(review).toHaveAttribute('aria-selected', 'true')

    await user.hover(manual)

    expect(review).toHaveAttribute('aria-selected', 'false')
    expect(manual).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(screen.getByRole('textbox')).toHaveValue('$manual ')
  })

  it('user completes a manual skill when pressing Tab, then arguments send with its identity', async () => {
    const user = userEvent.setup()
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    renderWithLibrary(<ChatComposer {...props} onSend={onSend} />)
    await waitForModelButton('Qwen 3 8B')
    await user.type(screen.getByRole('textbox'), '$')
    expect(await screen.findByRole('option', { name: /review/ })).toBeVisible()
    expect(screen.queryByRole('option', { name: /hidden/ })).toBeNull()
    expect(screen.getByText('review', { exact: true })).toBeVisible()
    expect(screen.getByText('Review the changes.', { exact: true })).toBeVisible()
    expect(screen.getByText('manual', { exact: true })).toBeVisible()
    expect(screen.queryByText('$review', { exact: true })).toBeNull()
    expect(screen.queryByText('Manual only')).toBeNull()
    expect(screen.queryByText('Project · .agents')).toBeNull()
    await user.keyboard('{ArrowDown}{Tab}')
    expect(screen.getByRole('textbox')).toHaveValue('$manual ')
    expect(screen.getByRole('textbox')).toHaveFocus()
    expect(onSend).not.toHaveBeenCalled()
    await user.type(screen.getByRole('textbox'), 'check this')
    await user.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledWith({
      text: '$manual check this',
      documents: [],
      skillInvocation: { skillId: 'manual', name: 'manual', arguments: 'check this' }
    })
  })

  it('user pastes long text after a skill when sending, then its arguments contain the original text', async () => {
    const user = userEvent.setup()
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    renderWithLibrary(<ChatComposer {...props} onSend={onSend} />)
    await waitForModelButton('Qwen 3 8B')
    await user.type(screen.getByRole('textbox'), '$manual ')
    const payload = 'a'.repeat(1_200)
    await user.paste(payload)
    await user.keyboard('{Enter}')

    expect(onSend).toHaveBeenCalledWith({
      text: `$manual ${payload}`,
      documents: [],
      skillInvocation: { skillId: 'manual', name: 'manual', arguments: payload }
    })
  })

  it('user pastes oversized skill arguments when sending, then the expanded text limit blocks submission', async () => {
    const user = userEvent.setup()
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    renderWithLibrary(<ChatComposer {...props} onSend={onSend} />)
    await waitForModelButton('Qwen 3 8B')
    await user.type(screen.getByRole('textbox'), '$manual ')
    await user.paste('a'.repeat(65_537))
    await user.keyboard('{Enter}')

    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('64 KiB')
  })

  it.each(['$missing argument', '/skill:missing argument', '/skill:review argument'])(
    'user sends %j when no invocable skill matches, then it remains a normal message',
    async (draft) => {
      const user = userEvent.setup()
      const onSend = vi
        .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
        .mockResolvedValue(true)
      renderWithLibrary(<ChatComposer {...props} onSend={onSend} />)
      await waitForModelButton('Qwen 3 8B')
      await user.type(screen.getByRole('textbox'), draft)
      await user.keyboard('{Enter}')
      expect(onSend).toHaveBeenCalledWith({ text: draft, documents: [] })
      expect(screen.getByRole('textbox')).toHaveValue('')
    }
  )

  it('user composes a skill query when Enter is composing, then selection and send wait', async () => {
    const user = userEvent.setup()
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    renderWithLibrary(<ChatComposer {...props} onSend={onSend} />)
    await waitForModelButton('Qwen 3 8B')
    await user.type(screen.getByRole('textbox'), '$')
    await screen.findByRole('option', { name: /review/ })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', isComposing: true })
    expect(screen.getByRole('textbox')).toHaveValue('$')
    expect(onSend).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), '$')
    expect(await screen.findByRole('option', { name: /review/ })).toBeVisible()
  })
  it.each([
    { name: 'keyCode 229', key: 'Enter', keyCode: 229 },
    { name: 'Process', key: 'Process', keyCode: 0 },
    { name: 'tracked composition', key: 'Enter', keyCode: 0 }
  ])(
    'user confirms IME text with $name when choosing a skill, then the draft stays intact',
    async ({ name, key, keyCode }) => {
      const user = userEvent.setup()
      const onSend = vi
        .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
        .mockResolvedValue(true)
      renderWithLibrary(<ChatComposer {...props} onSend={onSend} />)
      await waitForModelButton('Qwen 3 8B')
      const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')
      await user.type(textarea, '$rev')
      await screen.findByRole('option', { name: /review/ })
      // user-event does not synthesize IME lifecycle or browser legacy key codes.
      if (name === 'tracked composition') fireEvent.compositionStart(textarea)
      fireEvent.keyDown(textarea, { key, keyCode })
      if (name === 'tracked composition') fireEvent.compositionEnd(textarea)

      expect(textarea).toHaveValue('$rev')
      expect(onSend).not.toHaveBeenCalled()
      await user.keyboard('{Tab}')
      expect(textarea).toHaveValue('$review ')
    }
  )

  it('user presses Backspace when inside the invocation, then the whole token deletes in one step', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ChatComposer {...props} />)
    // SAFETY: ChatComposer's only textbox is its textarea draft control.
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox') as HTMLTextAreaElement
    await user.type(textarea, '$review here')
    textarea.setSelectionRange(4, 4)

    fireEvent.keyDown(textarea, { key: 'Backspace' })

    expect(textarea).toHaveValue(' here')
    expect(textarea.selectionStart).toBe(0)
  })

  it('user presses Backspace when behind the invocation separator, then only the space deletes', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ChatComposer {...props} />)
    // SAFETY: ChatComposer's only textbox is its textarea draft control.
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox') as HTMLTextAreaElement
    await user.type(textarea, '$review here')
    textarea.setSelectionRange(8, 8)

    const backspace = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true
    })
    textarea.dispatchEvent(backspace)

    expect(backspace.defaultPrevented).toBe(false)
  })

  it('user presses Ctrl+Backspace when behind a separator, then the token and separator delete together', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ChatComposer {...props} />)
    // SAFETY: ChatComposer's only textbox is its textarea draft control.
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox') as HTMLTextAreaElement
    await user.type(textarea, '$review here')
    textarea.setSelectionRange(8, 8)

    fireEvent.keyDown(textarea, { key: 'Backspace', ctrlKey: true })

    expect(textarea).toHaveValue('here')
    expect(textarea.selectionStart).toBe(0)
  })

  it('user presses Ctrl+Backspace when away from the invocation, then word deletion stays native', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ChatComposer {...props} />)
    // SAFETY: ChatComposer's only textbox is its textarea draft control.
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox') as HTMLTextAreaElement
    await user.type(textarea, '$review here')
    textarea.setSelectionRange(9, 9)

    const wordBackspace = new KeyboardEvent('keydown', {
      key: 'Backspace',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    })
    textarea.dispatchEvent(wordBackspace)

    expect(wordBackspace.defaultPrevented).toBe(false)
  })

  it.each([
    { key: 'ArrowLeft', caret: 4, expected: 0 },
    { key: 'ArrowRight', caret: 2, expected: 7 }
  ])(
    'user presses $key when inside the invocation, then the caret jumps past the whole token',
    async ({ key, caret, expected }) => {
      const user = userEvent.setup()
      renderWithLibrary(<ChatComposer {...props} />)
      // SAFETY: ChatComposer's only textbox is its textarea draft control.
      const textarea = screen.getByRole<HTMLTextAreaElement>('textbox') as HTMLTextAreaElement
      await user.type(textarea, '$review here')
      textarea.setSelectionRange(caret, caret)

      fireEvent.keyDown(textarea, { key })

      expect(textarea.selectionStart).toBe(expected)
    }
  )

  it('user presses an arrow when beside the invocation, then movement stays per character', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ChatComposer {...props} />)
    // SAFETY: ChatComposer's only textbox is its textarea draft control.
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox') as HTMLTextAreaElement
    await user.type(textarea, '$review here')
    textarea.setSelectionRange(7, 7)

    const arrow = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true
    })
    textarea.dispatchEvent(arrow)

    expect(arrow.defaultPrevented).toBe(false)
  })

  it('user moves focus out of the composer when the menu is open, then the menu dismisses', async () => {
    const user = userEvent.setup()
    renderWithLibrary(
      <>
        <button type="button">Outside action</button>
        <ChatComposer {...props} />
      </>
    )
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')
    await user.type(textarea, '$')
    expect(await screen.findByRole('option', { name: /review/ })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Outside action' }))

    expect(screen.queryByRole('listbox', { name: 'Commands and skills' })).toBeNull()
  })

  it.each(['Qwen 3 8B', 'Thinking effort: Medium', 'Tool permissions: Manual'])(
    'user opens %s when the command menu is open, then the menus do not stack',
    async (name) => {
      const user = userEvent.setup()
      renderWithLibrary(
        <ChatComposer
          {...props}
          projectPath="/projects/mico"
          onPermissionModeChange={() => undefined}
          reasoningCapabilities={{
            selectableEfforts: ['none', 'low', 'high'],
            defaultEffort: 'low'
          }}
        />
      )
      await waitForModelButton('Qwen 3 8B')
      await user.type(screen.getByRole('textbox', { name: 'Message' }), '$')
      expect(await screen.findByRole('option', { name: /review/ })).toBeVisible()

      await user.click(screen.getByRole('button', { name }))

      expect(screen.queryByRole('listbox', { name: 'Commands and skills' })).toBeNull()
      expect(screen.getByRole('button', { name, hidden: true })).toHaveAttribute(
        'aria-expanded',
        'true'
      )
    }
  )

  it('user types a query in different casing when choosing a skill, then matching ignores case', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ChatComposer {...props} />)

    await user.type(screen.getByRole('textbox'), '$REV')

    expect(await screen.findByRole('option', { name: /review/ })).toBeVisible()
  })

  it('user types a query when several skills match, then prefix matches rank first', async () => {
    const user = userEvent.setup()
    vi.mocked(window.api.chat.getSkillCatalog).mockResolvedValue({
      ...skillCatalog,
      skills: [
        ...skillCatalog.skills,
        {
          id: 'preview',
          name: 'preview',
          description: 'Preview the changes.',
          source: 'project-agents' as const,
          userInvocable: true,
          disableModelInvocation: false
        },
        {
          id: 'reviewer',
          name: 'reviewer',
          description: 'Act as a reviewer.',
          source: 'project-agents' as const,
          userInvocable: true,
          disableModelInvocation: false
        }
      ]
    })
    renderWithLibrary(<ChatComposer {...props} />)

    await user.type(screen.getByRole('textbox'), '$rev')

    const names = await screen.findAllByRole('option')
    expect(names.map((option) => option.textContent)).toEqual([
      expect.stringContaining('review'),
      expect.stringContaining('reviewer'),
      expect.stringContaining('preview')
    ])
  })

  it('user changes tool permissions when selecting an option, then the choice is shown', async () => {
    const user = userEvent.setup()
    function PermissionComposer(): React.JSX.Element {
      const [permissionMode, setPermissionMode] = React.useState<PermissionMode>('default')
      return (
        <ChatComposer
          {...props}
          permissionMode={permissionMode}
          onPermissionModeChange={setPermissionMode}
          projectLabel="Mico"
          projectPath="/projects/mico"
        />
      )
    }
    renderWithLibrary(<PermissionComposer />)
    await waitForModelButton('Qwen 3 8B')

    await user.click(screen.getByRole('button', { name: 'Tool permissions: Manual' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Accept edits' }))

    expect(screen.getByRole('button', { name: 'Tool permissions: Accept edits' })).toBeVisible()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it.each(['stop', 'disabled'] as const)(
    'user cannot change permissions when mode is %s, then the control is disabled',
    (mode) => {
      renderWithLibrary(
        <ChatComposer
          {...props}
          mode={mode}
          onPermissionModeChange={vi.fn<(mode: PermissionMode) => void>()}
          projectPath="/projects/mico"
        />
      )
      expect(screen.getByRole('button', { name: /^Tool permissions:/ })).toBeDisabled()
    }
  )

  it.each(['', 'Explain this file'])(
    'user sends documents with draft %j when pressing Send message, then attachments clear',
    async (text) => {
      const user = userEvent.setup()
      const document: ChatDocumentPart = { type: 'document', name: 'index.ts', text: 'export {}' }
      vi.mocked(window.api.attachments.pickCodeDocuments).mockResolvedValue([document])
      const onSend = vi.fn<() => Promise<boolean>>(async () => true)
      renderWithLibrary(<ChatComposer {...props} onSend={onSend} />)
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
    renderWithLibrary(<ChatComposer {...props} onSend={onSend} />)
    await waitForModelButton('Qwen 3 8B')
    await user.click(screen.getByRole('button', { name: 'Add attachment' }))
    await user.click(screen.getByRole('menuitem', { name: 'Attach files' }))
    await screen.findByText('index.ts')
    await user.type(screen.getByRole('textbox'), 'Review this file')
    await user.click(screen.getByRole('button', { name: 'Send message' }))

    expect(screen.getByRole('textbox')).toHaveValue('Review this file')
    expect(screen.getByText('index.ts')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Sending message' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Sending message')

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
      renderWithLibrary(<ChatComposer {...props} mode={mode} />)
      expect(screen.getByRole('button', { name: 'Add attachment' })).toBeDisabled()
    }
  )

  it('user submits a draft when pressing Send message, then the sent content is shown', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ComposerHarness />)

    await waitForModelButton('Qwen 3 8B')

    await user.type(screen.getByRole('textbox'), 'A multi-line draft.')

    await user.click(screen.getByRole('button', { name: 'Send message' }))

    expect(screen.getByText('A multi-line draft.')).toBeVisible()
  })

  it('user gets a workspace control when starting a new chat, then adding one binds it', async () => {
    const user = userEvent.setup()
    const { rerender } = renderWithLibrary(<WorkspaceComposerHarness />)

    expect(screen.queryByRole('button', { name: 'Choose workspace' })).toBeNull()

    rerenderWithLibrary(rerender, <WorkspaceComposerHarness canAddProject />)

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

  it('user opens a workspace menu when its tooltip is visible, then the tooltip is suppressed', async () => {
    const user = userEvent.setup()
    renderWorkspaceComposer({
      projectLabel: 'Project one',
      projectPath: '/projects/one',
      projects: [
        { id: 'project-1', name: 'Project one', rootPath: '/projects/one', isDefault: true }
      ]
    })
    const trigger = screen.getByRole('button', { name: 'Workspace: Project one (/projects/one)' })
    fireEvent.focus(trigger)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Workspace: Project one')
    expect(trigger).not.toHaveAttribute('title')

    await user.click(trigger)

    expect(screen.getByRole('textbox', { name: 'Search workspaces' })).toBeVisible()
    expect(screen.queryByRole('tooltip')).toBeNull()
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

    renderWithLibrary(<RefreshingWorkspaceComposer />)

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

  it('user opens an empty composer when the conversation offers commands and skills, then a static hint teaches the syntax', async () => {
    renderWithLibrary(<ChatComposer {...props} onCompact={() => undefined} />)

    const hint = await screen.findByText('Use / for commands, $ for skills.')
    expect(hint).toBeVisible()
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Hello')
    expect(screen.queryByText('Use / for commands, $ for skills.')).toBeNull()
    await user.clear(screen.getByRole('textbox', { name: 'Message' }))
    expect(screen.getByText('Use / for commands, $ for skills.')).toBeVisible()
  })

  it('user double-clicks an empty composer when hints are offered, then the hint cannot be selected', async () => {
    renderWithLibrary(<ChatComposer {...props} onCompact={() => undefined} />)

    // Chromium selects an empty textarea's native placeholder on double-click,
    // so the hint is an inert overlay: nothing selectable, no placeholder text.
    // The overlay is aria-hidden, so the textarea describes itself with the
    // same hint for screen readers.
    const hint = await screen.findByText('Use / for commands, $ for skills.')
    expect(hint).toHaveAttribute('aria-hidden', 'true')
    expect(hint).toHaveClass('pointer-events-none', 'select-none')
    expect(screen.getByRole('textbox')).not.toHaveAttribute('placeholder')
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveAccessibleDescription(
      'Use / for commands, $ for skills.'
    )
  })

  it('user opens a composer when commands and skills are unavailable, then syntax hints are omitted', async () => {
    renderWithLibrary(<ChatComposer {...props} projectId={null} />)

    // The base input stays quiet: no hint and no placeholder, only the native caret.
    expect(screen.queryByText(/^Use (\/|\$) for/)).toBeNull()
    expect(screen.getByRole('textbox')).not.toHaveAttribute('placeholder')
  })

  it('user keeps control focus when typing a letter on a button, then the composer does not steal it', async () => {
    const user = userEvent.setup()
    renderWithLibrary(
      <>
        <button type="button">Conversation action</button>
        <ChatComposer {...props} />
      </>
    )

    const button = screen.getByRole('button', { name: 'Conversation action' })
    button.focus()
    await user.keyboard('h')

    expect(button).toHaveFocus()
    expect(screen.getByRole('textbox')).not.toHaveFocus()
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('user types when a tool log has focus, then the composer receives the text', async () => {
    const user = userEvent.setup()
    renderWithLibrary(
      <>
        <div role="log" tabIndex={0}>
          Tool output
        </div>
        <ChatComposer {...props} />
      </>
    )

    screen.getByRole('log').focus()
    await user.keyboard('h')

    expect(screen.getByRole('textbox')).toHaveFocus()
    expect(screen.getByRole('textbox')).toHaveValue('h')
  })

  it('user keeps the draft unfocused when pressing a non-text key, then the textarea ignores it', () => {
    renderWithLibrary(<ChatComposer {...props} />)

    fireEvent.keyDown(window, { key: 'ArrowDown' })

    expect(screen.getByRole('textbox')).not.toHaveFocus()
  })

  it('user sees the textarea shrink back when sending, then the draft returns to one line', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ComposerHarness />)

    await waitForModelButton('Qwen 3 8B')

    // SAFETY: ChatComposer's only textbox is its textarea draft control.
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox') as HTMLTextAreaElement
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
    renderWithLibrary(<ComposerHarness mode="stop" />)

    await user.click(screen.getByRole('button', { name: 'Stop response' }))

    expect(screen.getByText('Response stopped')).toBeVisible()
  })

  it('user cannot send when no model is enabled, then the send control stays disabled', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        chat: {
          getSkillCatalog: vi.fn<ChatAPI['getSkillCatalog']>().mockResolvedValue(skillCatalog)
        },
        providers: {
          getLibrary: vi
            .fn<() => Promise<typeof library>>()
            .mockResolvedValue({ ...library, selectedModelId: null }),
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
    renderWithLibrary(<ChatComposer {...props} />)

    await waitForModelButton('Select model')
    await user.type(screen.getByRole('textbox'), 'Hello{Enter}there')

    expect(screen.getByRole('textbox')).toHaveValue('Hello\nthere')
    expect(
      screen.getByRole('button', { name: 'Select an enabled model to send messages' })
    ).toBeDisabled()
  })

  it('user selects a model in the composer when picking one, then the parent is notified', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        chat: {
          getSkillCatalog: vi.fn<ChatAPI['getSkillCatalog']>().mockResolvedValue(skillCatalog)
        },
        providers: {
          // SAFETY: the provider library is served with the model unselected, then selected.
          getLibrary: vi
            .fn<() => Promise<typeof library>>()
            .mockResolvedValueOnce({ ...library, selectedModelId: null })
            .mockResolvedValue(library),
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

    renderWithLibrary(<ModelSelectionHarness />)

    await waitForModelButton('Select model')
    await user.click(screen.getByRole('button', { name: 'Select model' }))
    await user.click(screen.getByRole('option', { name: 'Qwen 3 8B' }))

    expect(await screen.findByText('Capabilities refreshed')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Qwen 3 8B' })).toBeVisible()
  })

  it('user gets no thinking menu when the model has nothing adjustable, then it is absent', () => {
    renderWithLibrary(<ChatComposer {...props} />)

    expect(screen.queryByRole('button', { name: 'Thinking effort' })).toBeNull()
  })

  it('user sees only advertised efforts when opening the thinking menu, then the rest are missing', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ThinkingEffortHarness />)

    await user.click(screen.getByRole('button', { name: /^Thinking effort:/ }))

    expect(screen.queryByRole('menuitemradio', { name: 'Default' })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: /^Off/ })).toBeVisible()
    expect(screen.queryByRole('menuitemradio', { name: /^Medium/ })).toBeNull()
  })

  it('user commits the chosen effort when selecting an option, then the parent receives it', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ThinkingEffortHarness />)

    await user.click(screen.getByRole('button', { name: /^Thinking effort:/ }))

    await user.click(screen.getByRole('menuitemradio', { name: /^High/ }))

    expect(screen.getByText('Thinking effort: high')).toBeVisible()
  })

  it.each(['stop', 'disabled'] as const)(
    'user cannot adjust thinking when the mode is %s, then the menu stays disabled',
    (mode) => {
      renderWithLibrary(
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

  it('user opens the menu when typing $, then only skills are offered', async () => {
    const user = userEvent.setup()
    const onCompact = vi.fn<() => void>()
    renderWithLibrary(<ChatComposer {...props} onCompact={onCompact} />)

    await user.type(screen.getByRole('textbox'), '$')

    expect(await screen.findByRole('option', { name: /review/ })).toBeVisible()
    expect(screen.getByRole('option', { name: /manual/ })).toBeVisible()
    expect(screen.queryByRole('option', { name: /Compact context/ })).toBeNull()
    expect(screen.queryByRole('option', { name: /hidden/ })).toBeNull()
    expect(onCompact).not.toHaveBeenCalled()
  })

  it('user completes a skill with $ when pressing Tab, then arguments send with its identity', async () => {
    const user = userEvent.setup()
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    renderWithLibrary(<ChatComposer {...props} onSend={onSend} />)
    await waitForModelButton('Qwen 3 8B')

    await user.type(screen.getByRole('textbox'), '$rev')
    expect(await screen.findByRole('option', { name: /review/ })).toBeVisible()
    await user.keyboard('{Tab}')
    expect(screen.getByRole('textbox')).toHaveValue('$review ')
    await user.type(screen.getByRole('textbox'), 'check this')
    await user.keyboard('{Enter}')

    expect(onSend).toHaveBeenCalledWith({
      text: '$review check this',
      documents: [],
      skillInvocation: { skillId: 'review', name: 'review', arguments: 'check this' }
    })
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('user completes a skill when editing its token, then existing arguments remain', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ChatComposer {...props} />)
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')

    await user.type(textarea, '$rev existing arguments')
    expect(screen.queryByRole('listbox', { name: 'Commands and skills' })).toBeNull()
    // Selection cannot be positioned with user-event without replaying unrelated keys.
    fireEvent.select(textarea, { target: { selectionStart: 4, selectionEnd: 4 } })
    expect(await screen.findByRole('option', { name: /review/ })).toBeVisible()
    await user.keyboard('{Tab}')

    expect(textarea).toHaveValue('$review existing arguments')
    await user.keyboard('new ')
    expect(textarea).toHaveValue('$review new existing arguments')
  })

  it('user mentions a skill mid-message when sending, then it stays a normal message', async () => {
    const user = userEvent.setup()
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    renderWithLibrary(<ChatComposer {...props} onSend={onSend} />)
    await waitForModelButton('Qwen 3 8B')

    await user.type(screen.getByRole('textbox'), 'costs $100 and $unknown here')
    await user.keyboard('{Enter}')

    expect(onSend).toHaveBeenCalledWith({ text: 'costs $100 and $unknown here', documents: [] })
  })

  it('user selects menu ends when pressing Home and End, then selection follows', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ChatComposer {...props} />)

    await user.type(screen.getByRole('textbox'), '$')
    await screen.findByRole('option', { name: /review/ })
    await user.keyboard('{End}')
    expect(screen.getByRole('option', { name: /manual/ })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Home}')
    expect(screen.getByRole('option', { name: /review/ })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(screen.getByRole('textbox')).toHaveValue('$review ')
  })

  it('user presses Alt+Enter when the menu is open, then its platform behavior stays available', async () => {
    const user = userEvent.setup()
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    renderWithLibrary(<ChatComposer {...props} onSend={onSend} />)
    await waitForModelButton('Qwen 3 8B')

    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')
    await user.type(textarea, '$')
    await screen.findByRole('option', { name: /review/ })
    // Alt+Enter behavior differs by platform; the composer leaves it available
    // instead of consuming it as completion or submission.
    const altEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      altKey: true,
      bubbles: true,
      cancelable: true
    })
    textarea.dispatchEvent(altEnter)

    expect(altEnter.defaultPrevented).toBe(false)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('user switches conversations when drafting, then each conversation keeps its own draft', async () => {
    const user = userEvent.setup()
    const { rerender } = renderWithLibrary(
      <ChatComposer {...props} draftConversationId="conversation-1" />
    )
    await user.type(screen.getByRole('textbox'), 'First draft')

    rerenderWithLibrary(rerender, <ChatComposer {...props} draftConversationId="conversation-2" />)
    expect(screen.getByRole('textbox')).toHaveValue('')
    await user.type(screen.getByRole('textbox'), 'Second draft')

    rerenderWithLibrary(rerender, <ChatComposer {...props} draftConversationId="conversation-1" />)
    expect(screen.getByRole('textbox')).toHaveValue('First draft')
  })

  it('user types a follow-up when the first send is pending, then the new draft survives', async () => {
    const user = userEvent.setup()
    let resolveSend!: (accepted: boolean) => void
    const onSend = vi.fn<React.ComponentProps<typeof ChatComposer>['onSend']>(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSend = resolve
        })
    )
    const { rerender } = renderWithLibrary(
      <ChatComposer {...props} draftConversationId={null} onSend={onSend} />
    )
    await waitForModelButton('Qwen 3 8B')
    await user.type(screen.getByRole('textbox'), 'Hello there')
    await user.keyboard('{Enter}')
    rerenderWithLibrary(
      rerender,
      <ChatComposer {...props} draftConversationId="conversation-1" onSend={onSend} />
    )
    expect(screen.getByRole('textbox')).toHaveValue('')
    await user.type(screen.getByRole('textbox'), 'Follow-up draft')

    await act(async () => resolveSend(true))

    expect(screen.getByRole('textbox')).toHaveValue('Follow-up draft')
    rerenderWithLibrary(rerender, <ChatComposer {...props} draftConversationId={null} />)
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('user returns to a conversation when leaving Settings, then text and attachments survive', async () => {
    const user = userEvent.setup()
    const document: ChatDocumentPart = { type: 'document', name: 'index.ts', text: 'export {}' }
    vi.mocked(window.api.attachments.pickCodeDocuments).mockResolvedValue([document])
    const { unmount } = renderWithLibrary(
      <ChatComposer {...props} draftConversationId="conversation-1" />
    )
    await waitForModelButton('Qwen 3 8B')
    await user.type(screen.getByRole('textbox'), 'Keep this draft')
    await user.click(screen.getByRole('button', { name: 'Add attachment' }))
    await user.click(screen.getByRole('menuitem', { name: 'Attach files' }))
    await screen.findByText('index.ts')

    unmount()
    renderWithLibrary(<ChatComposer {...props} draftConversationId="conversation-1" />)

    expect(await screen.findByText('index.ts')).toBeVisible()
    expect(screen.getByRole('textbox')).toHaveValue('Keep this draft')
  })

  it('user switches conversations when picking a file, then attachments stay with the original draft', async () => {
    const user = userEvent.setup()
    const existing: ChatDocumentPart = { type: 'document', name: 'existing.ts', text: 'export {}' }
    const picked: ChatDocumentPart = {
      type: 'document',
      name: 'picked.ts',
      text: 'const ready = true'
    }
    let resolvePick!: (documents: ChatDocumentPart[]) => void
    vi.mocked(window.api.attachments.pickCodeDocuments)
      .mockResolvedValueOnce([existing])
      .mockImplementationOnce(
        () =>
          new Promise<ChatDocumentPart[]>((resolve) => {
            resolvePick = resolve
          })
      )
    const { rerender } = renderWithLibrary(
      <ChatComposer {...props} draftConversationId="conversation-2" />
    )
    await user.click(screen.getByRole('button', { name: 'Add attachment' }))
    await user.click(screen.getByRole('menuitem', { name: 'Attach files' }))
    await screen.findByText('existing.ts')
    rerenderWithLibrary(rerender, <ChatComposer {...props} draftConversationId="conversation-1" />)
    await user.click(screen.getByRole('button', { name: 'Add attachment' }))
    await user.click(screen.getByRole('menuitem', { name: 'Attach files' }))
    rerenderWithLibrary(rerender, <ChatComposer {...props} draftConversationId="conversation-2" />)

    await act(async () => resolvePick([picked]))

    expect(screen.getByText('existing.ts')).toBeVisible()
    expect(screen.queryByText('picked.ts')).toBeNull()
    rerenderWithLibrary(rerender, <ChatComposer {...props} draftConversationId="conversation-1" />)
    expect(screen.getByText('picked.ts')).toBeVisible()
    expect(screen.queryByText('existing.ts')).toBeNull()
  })

  it('user switches conversations when a send is pending, then only the submitted draft clears', async () => {
    const user = userEvent.setup()
    let resolveSend!: (accepted: boolean) => void
    const onSend = vi.fn<React.ComponentProps<typeof ChatComposer>['onSend']>(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSend = resolve
        })
    )
    const { rerender } = renderWithLibrary(
      <ChatComposer {...props} draftConversationId="conversation-2" onSend={onSend} />
    )
    await waitForModelButton('Qwen 3 8B')
    await user.type(screen.getByRole('textbox'), 'Conversation two draft')
    rerenderWithLibrary(
      rerender,
      <ChatComposer {...props} draftConversationId="conversation-1" onSend={onSend} />
    )
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'Conversation one draft')
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    rerenderWithLibrary(
      rerender,
      <ChatComposer {...props} draftConversationId="conversation-2" onSend={onSend} />
    )
    expect(screen.getByRole('textbox')).toHaveValue('Conversation two draft')

    await act(async () => resolveSend(true))

    expect(screen.getByRole('textbox')).toHaveValue('Conversation two draft')
    rerenderWithLibrary(
      rerender,
      <ChatComposer {...props} draftConversationId="conversation-1" onSend={onSend} />
    )
    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(onSend).toHaveBeenCalledWith({
      text: 'Conversation one draft',
      documents: []
    })
  })

  it.each([
    { name: 'a long message', text: 'a'.repeat(1_000) },
    { name: 'a long log', text: 'line\n'.repeat(10) + 'line' }
  ])(
    'user pastes $name when drafting, then it collapses into one labeled token',
    async ({ text }) => {
      const user = userEvent.setup()
      renderWithLibrary(<ChatComposer {...props} />)
      const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')
      textarea.focus()

      await user.paste(text)

      expect(textarea.value).toMatch(
        new RegExp(`^\\[Pasted ${text.length.toLocaleString('en-US')} chars · [a-z0-9]{6}\\]$`)
      )
    }
  )

  it('user pastes two long messages when drafting, then each token keeps its own payload', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ChatComposer {...props} />)
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')
    textarea.focus()
    const first = 'a'.repeat(1_000)
    const second = 'b'.repeat(1_000)

    await user.paste(first)
    await user.keyboard(' ')
    await user.paste(second)

    const labels = textarea.value.match(/\[Pasted 1,000 chars · [a-z0-9]{6}\]/g) ?? []
    expect(labels).toHaveLength(2)
    expect(labels[0]).not.toBe(labels[1])
  })

  it('user pastes a short message when drafting, then it stays ordinary text', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ChatComposer {...props} />)
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')
    textarea.focus()

    await user.paste('short note')

    expect(textarea).toHaveValue('short note')
  })

  it('user sends a draft when reference text is pasted, then the full original is delivered', async () => {
    const user = userEvent.setup()
    const longText = 'a'.repeat(1_000)
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    renderWithLibrary(<ChatComposer {...props} onSend={onSend} />)
    await waitForModelButton('Qwen 3 8B')
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')
    textarea.focus()
    await user.paste(longText)
    const label = textarea.value
    await user.type(textarea, 'Explain this log')

    await user.keyboard('{Enter}')

    expect(onSend).toHaveBeenCalledWith({
      text: `${longText}Explain this log`,
      documents: []
    })
    expect(textarea).toHaveValue('')
    // A cleared draft leaves no stale token metadata behind.
    expect(label).toMatch(/^\[Pasted 1,000 chars · [a-z0-9]{6}\]$/)
  })

  it('user copies a selection when it touches a paste token, then the clipboard holds the full original', () => {
    renderWithLibrary(<ChatComposer {...props} />)
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')
    textarea.focus()
    const longText = 'a'.repeat(1_000)
    fireEvent.paste(textarea, {
      clipboardData: { getData: (): string => longText, types: ['text/plain'] }
    })
    const setData = vi.fn<(type: string, text: string) => void>()

    textarea.setSelectionRange(0, textarea.value.length)
    const copy = fireEvent.copy(textarea, {
      clipboardData: { setData, getData: (): string => '' }
    })

    expect(setData).toHaveBeenCalledWith('text/plain', longText)
    expect(copy).toBe(false)
  })

  it('user cuts a selection when it touches a paste token, then the clipboard keeps the original and the label retires', () => {
    renderWithLibrary(<ChatComposer {...props} />)
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')
    textarea.focus()
    const longText = 'a'.repeat(1_000)
    fireEvent.paste(textarea, {
      clipboardData: { getData: (): string => longText, types: ['text/plain'] }
    })
    const label = textarea.value
    const setData = vi.fn<(type: string, text: string) => void>()

    textarea.setSelectionRange(0, textarea.value.length)
    fireEvent.cut(textarea, { clipboardData: { setData, getData: (): string => '' } })

    expect(setData).toHaveBeenCalledWith('text/plain', longText)
    expect(textarea).toHaveValue('')
    // Retyping the exact unique label re-associates the retired payload.
    fireEvent.input(textarea, { target: { value: label } })
    expect(textarea).toHaveValue(label)
  })

  it('user edits a paste token label when drafting, then sending is blocked until it is repaired', async () => {
    const user = userEvent.setup()
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    renderWithLibrary(<ChatComposer {...props} onSend={onSend} />)
    await waitForModelButton('Qwen 3 8B')
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')
    textarea.focus()
    const longText = 'a'.repeat(1_000)
    await user.paste(longText)
    const label = textarea.value
    // Arrow keys jump atomically across tokens, so the caret is placed inside
    // the label directly.
    textarea.setSelectionRange(4, 4)
    await user.keyboard('x')
    expect(textarea.value).not.toBe(label)
    expect(screen.getByRole('alert')).toBeVisible()

    await user.keyboard('{Enter}')

    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Restore pasted text' }))

    expect(textarea).toHaveValue(label)
  })

  it('user sends when a token label has no original text, then the send is blocked with guidance', async () => {
    const user = userEvent.setup()
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    renderWithLibrary(<ChatComposer {...props} onSend={onSend} />)
    await waitForModelButton('Qwen 3 8B')

    await user.type(screen.getByRole('textbox'), 'report [[Pasted 9 chars · dead00] attached')
    await user.keyboard('{Enter}')

    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/has no original text/)
  })

  it('user pastes when the browser refuses the edit, then existing payloads survive for retry', async () => {
    const user = userEvent.setup()
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    renderWithLibrary(<ChatComposer {...props} onSend={onSend} />)
    await waitForModelButton('Qwen 3 8B')
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')
    textarea.focus()
    await user.paste('a'.repeat(1_000))
    const label = textarea.value
    // jsdom has no native editing stack; refusal is supplied at the same
    // document API seam as the successful edit stub, without changing owner state.
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn<typeof document.execCommand>().mockReturnValue(false)
    })
    await user.paste('b'.repeat(1_000))
    expect(textarea).toHaveValue(label)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not collapse this paste')
    expect(chatComposerDrafts.getDraft(composerDraftKey(null)).pasteTokens).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect(onSend).toHaveBeenCalledWith({ text: 'a'.repeat(1_000), documents: [] })
  })

  it('user cuts when the browser refuses deletion, then the clipboard expands and the draft stays', async () => {
    const user = userEvent.setup()
    renderWithLibrary(<ChatComposer {...props} />)
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')
    textarea.focus()
    const payload = 'a'.repeat(1_000)
    await user.paste(payload)
    const label = textarea.value
    // Reject only the browser edit, leaving the real clipboard and token owner active.
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn<typeof document.execCommand>().mockReturnValue(false)
    })
    const setData = vi.fn<(type: string, text: string) => void>()
    textarea.setSelectionRange(0, label.length)
    fireEvent.cut(textarea, { clipboardData: { setData, getData: (): string => '' } })
    expect(setData).toHaveBeenCalledWith('text/plain', payload)
    expect(textarea).toHaveValue(label)
    expect(screen.getByRole('alert')).toHaveTextContent('editor could not cut it')
  })

  it('user repairs when the browser refuses the edit, then damage keeps blocking the send', async () => {
    const user = userEvent.setup()
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    renderWithLibrary(<ChatComposer {...props} onSend={onSend} />)
    await waitForModelButton('Qwen 3 8B')
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')
    textarea.focus()
    await user.paste('a'.repeat(1_000))
    textarea.setSelectionRange(4, 4)
    await user.keyboard('x')
    const broken = textarea.value
    // The browser refuses repair; input reconciliation still runs only on real input events.
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn<typeof document.execCommand>().mockReturnValue(false)
    })
    await user.click(screen.getByRole('button', { name: 'Restore pasted text' }))
    expect(textarea).toHaveValue(broken)
    expect(
      screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('Could not restore'))
    ).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect(onSend).not.toHaveBeenCalled()
  })

  it('user switches conversations when a paste is captured, then the token keeps its payload', async () => {
    const user = userEvent.setup()
    const longText = 'a'.repeat(1_000)
    const onSend = vi
      .fn<React.ComponentProps<typeof ChatComposer>['onSend']>()
      .mockResolvedValue(true)
    const { rerender } = renderWithLibrary(
      <ChatComposer {...props} draftConversationId="conversation-1" onSend={onSend} />
    )
    await waitForModelButton('Qwen 3 8B')
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')
    textarea.focus()
    await user.paste(longText)
    const label = textarea.value

    rerenderWithLibrary(rerender, <ChatComposer {...props} draftConversationId="conversation-2" />)
    expect(textarea).toHaveValue('')
    rerenderWithLibrary(
      rerender,
      <ChatComposer {...props} draftConversationId="conversation-1" onSend={onSend} />
    )
    expect(textarea).toHaveValue(label)

    await user.keyboard('{Enter}')

    expect(onSend).toHaveBeenCalledWith({ text: longText, documents: [] })
  })
})
