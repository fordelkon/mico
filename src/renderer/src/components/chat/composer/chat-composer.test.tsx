import '@testing-library/jest-dom/vitest'

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import { ChatComposer } from './chat-composer'

const props = {
  focusKey: 0,
  mode: 'send' as const,
  onSend: (): void => undefined,
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
        onSend={setSentContent}
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
      projectLabel={projectLabel}
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

    expect(screen.getByLabelText('Workspace: Project one')).toBeVisible()
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

    await user.click(screen.getByRole('button', { name: 'Thinking effort' }))

    expect(screen.queryByRole('menuitemradio', { name: 'Default' })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'Off' })).toBeVisible()
    expect(screen.queryByRole('menuitemradio', { name: 'Medium' })).toBeNull()
  })

  it('commits the selected thinking effort', async () => {
    const user = userEvent.setup()
    render(<ThinkingEffortHarness />)

    await user.click(screen.getByRole('button', { name: 'Thinking effort' }))

    await user.click(screen.getByRole('menuitemradio', { name: 'High' }))

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

      expect(screen.getByRole('button', { name: 'Thinking effort' })).toBeDisabled()
    }
  )
})
