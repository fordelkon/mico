import '@testing-library/jest-dom/vitest'

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderLibrary as PersistedProviderLibrary } from '@shared/data/schemas/provider'

import { SettingsMain } from './settings-main'
import {
  ProviderLibraryProvider,
  useProviderLibraryActions,
  useProviderLibraryState
} from './providers/provider-library'

function renderSettings(): void {
  render(
    <ProviderLibraryProvider>
      <SettingsMain />
    </ProviderLibraryProvider>
  )
}

function ActionOnlyConsumer({ onRender }: { onRender: () => void }): React.JSX.Element {
  onRender()
  const { selectProvider } = useProviderLibraryActions()
  return <button onClick={() => void selectProvider('ollama')}>Select provider</button>
}

function SelectedProviderConsumer(): React.JSX.Element {
  const { library } = useProviderLibraryState()
  return <output>{library.selectedProviderId ?? 'none'}</output>
}

async function waitForOllama(): Promise<void> {
  await screen.findByRole('heading', { level: 2, name: 'Ollama' })
}

const providerApi = {
  addCustomProvider: vi.fn(),
  discoverModels: vi.fn(),
  getLibrary: vi.fn(),
  saveLibrary: vi.fn(),
  importModel: vi.fn(),
  removeCustomProvider: vi.fn(),
  removeModel: vi.fn(),
  saveConfiguration: vi.fn(),
  selectProvider: vi.fn(),
  setModelEnabled: vi.fn(),
  syncModels: vi.fn(),
  testModel: vi.fn(),
  updateCustomProvider: vi.fn()
}
const windowControlsApi = {
  onProviderDraftFlush: vi.fn(() => () => undefined)
}

let persistedLibrary: PersistedProviderLibrary

beforeEach(() => {
  persistedLibrary = {
    configurations: [
      { provider: 'lm-studio', baseUrl: 'http://localhost:1234' },
      { provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: true }
    ],
    customProviders: [],
    enabledProviderIds: ['ollama'],
    models: [],
    selectedModelId: null,
    selectedProviderId: null
  }
  providerApi.addCustomProvider.mockReset()
  providerApi.addCustomProvider.mockImplementation(async (provider) => {
    const saved = { ...provider, id: 'example-ai' }
    persistedLibrary = {
      ...persistedLibrary,
      customProviders: [...persistedLibrary.customProviders, saved]
    }
    return saved
  })
  providerApi.getLibrary.mockReset()
  providerApi.getLibrary.mockImplementation(async () => persistedLibrary)
  providerApi.saveLibrary.mockReset()
  providerApi.saveLibrary.mockImplementation(async (library) => {
    persistedLibrary = library
    return library
  })
  providerApi.selectProvider.mockReset()
  providerApi.selectProvider.mockImplementation(async (providerId) => {
    persistedLibrary = { ...persistedLibrary, selectedProviderId: providerId }
    return providerId
  })
  providerApi.discoverModels.mockReset()
  providerApi.discoverModels.mockResolvedValue([
    { modelId: 'granite4.2:3b', displayName: 'granite4.2:3b' }
  ])
  providerApi.removeCustomProvider.mockReset()
  providerApi.removeCustomProvider.mockImplementation(async (providerId) => {
    persistedLibrary = {
      ...persistedLibrary,
      customProviders: persistedLibrary.customProviders.filter(({ id }) => id !== providerId),
      models: persistedLibrary.models.filter(({ provider }) => provider !== providerId)
    }
  })
  providerApi.updateCustomProvider.mockReset()
  providerApi.updateCustomProvider.mockImplementation(async (provider) => {
    if (provider.apiKey === '') throw new Error('Invalid custom provider')
    persistedLibrary = {
      ...persistedLibrary,
      customProviders: persistedLibrary.customProviders.map((current) =>
        current.id === provider.id ? provider : current
      )
    }
    return provider
  })
  providerApi.testModel.mockReset()
  providerApi.testModel.mockResolvedValue(undefined)
  providerApi.saveConfiguration.mockReset()
  providerApi.saveConfiguration.mockImplementation(async (configuration) => {
    persistedLibrary = {
      ...persistedLibrary,
      configurations: [
        ...persistedLibrary.configurations.filter(
          ({ provider }) => provider !== configuration.provider
        ),
        configuration
      ]
    }
    return configuration
  })
  providerApi.importModel.mockReset()
  providerApi.importModel.mockImplementation(async (model) => ({ id: 'saved-model', ...model }))
  providerApi.removeModel.mockReset()
  providerApi.removeModel.mockResolvedValue(undefined)
  providerApi.syncModels.mockReset()
  providerApi.syncModels.mockImplementation(async ({ models, provider }) => {
    const existingModels = persistedLibrary.models.filter((model) => model.provider === provider)
    const discoveredModels = new Map<string, { displayName: string; modelId: string }>(
      models.map((model) => [model.modelId, model])
    )
    persistedLibrary = {
      ...persistedLibrary,
      models: [
        ...existingModels.flatMap((model) => {
          const discovered = discoveredModels.get(model.modelId)
          return discovered ? [{ ...model, displayName: `Saved ${discovered.displayName}` }] : []
        }),
        ...models
          .filter((model) => !existingModels.some(({ modelId }) => modelId === model.modelId))
          .map(({ displayName, modelId }) => ({
            displayName,
            enabled: false,
            id: `${provider}:${modelId}`,
            modelId,
            provider
          }))
      ]
    }
  })
  providerApi.setModelEnabled.mockReset()
  providerApi.setModelEnabled.mockImplementation(async ({ enabled, modelId }) => {
    const model = persistedLibrary.models.find(({ id }) => id === modelId)
    if (!model) throw new Error('Provider model was not found.')
    const saved = { ...model, enabled }
    persistedLibrary = {
      ...persistedLibrary,
      models: persistedLibrary.models.map((current) => (current.id === modelId ? saved : current))
    }
    return saved
  })
  windowControlsApi.onProviderDraftFlush.mockClear()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { providers: providerApi, windowControls: windowControlsApi }
  })
})

describe('SettingsMain', () => {
  it('renders the Appearance settings page', () => {
    render(<SettingsMain page="appearance" />)

    expect(screen.getByRole('heading', { level: 1, name: 'Appearance' })).toBeVisible()
  })

  it('does not replace the persisted library while Strict Mode hydrates settings', async () => {
    persistedLibrary = {
      ...persistedLibrary,
      customProviders: [
        {
          apiFormat: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          enabled: true,
          headers: {},
          icon: 'cloud',
          id: 'example-ai',
          name: 'Example AI',
          useMaxCompletionTokens: false
        }
      ],
      enabledProviderIds: ['ollama', 'example-ai']
    }

    render(
      <React.StrictMode>
        <ProviderLibraryProvider>
          <SettingsMain />
        </ProviderLibraryProvider>
      </React.StrictMode>
    )

    expect(await screen.findByRole('button', { name: 'Example AI' })).toBeVisible()
    expect(providerApi.saveLibrary).not.toHaveBeenCalled()
  })

  it('does not render manual save controls', () => {
    renderSettings()

    expect(screen.queryByText('All changes saved')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  it('keeps action-only consumers isolated from provider state updates', async () => {
    const user = userEvent.setup()
    const onRender = vi.fn()
    render(
      <ProviderLibraryProvider>
        <ActionOnlyConsumer onRender={onRender} />
        <SelectedProviderConsumer />
      </ProviderLibraryProvider>
    )

    await waitFor(() => expect(providerApi.getLibrary).toHaveBeenCalled())
    expect(onRender).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Select provider' }))

    expect(screen.getByText('ollama')).toBeVisible()
    expect(onRender).toHaveBeenCalledTimes(1)
  })

  it('selects the first provider in sidebar order after loading the library', async () => {
    providerApi.getLibrary.mockResolvedValueOnce({
      configurations: [
        { provider: 'lm-studio', baseUrl: 'http://localhost:1234', enabled: true },
        { provider: 'ollama', baseUrl: 'http://localhost:11434' }
      ],
      customProviders: [],
      models: [],
      selectedModelId: null
    })

    renderSettings()

    expect(await screen.findByRole('heading', { level: 2, name: 'LM Studio' })).toBeVisible()
  })

  it('restores the last visited provider after loading the library', async () => {
    providerApi.getLibrary.mockResolvedValueOnce({
      configurations: [
        { provider: 'lm-studio', baseUrl: 'http://localhost:1234', enabled: true },
        { provider: 'ollama', baseUrl: 'http://localhost:11434' }
      ],
      customProviders: [],
      models: [],
      selectedModelId: null,
      selectedProviderId: 'ollama'
    })

    renderSettings()

    expect(await screen.findByRole('heading', { level: 2, name: 'Ollama' })).toBeVisible()
  })

  it('falls back from a missing saved provider to the first provider', async () => {
    providerApi.getLibrary.mockResolvedValueOnce({
      configurations: [
        { provider: 'lm-studio', baseUrl: 'http://localhost:1234', enabled: true },
        { provider: 'ollama', baseUrl: 'http://localhost:11434' }
      ],
      customProviders: [],
      models: [],
      selectedModelId: null,
      selectedProviderId: 'missing-custom-provider'
    })

    renderSettings()

    expect(await screen.findByRole('heading', { level: 2, name: 'LM Studio' })).toBeVisible()
  })

  it('restores the last visited provider after returning to settings', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <ProviderLibraryProvider>
        <SettingsMain />
      </ProviderLibraryProvider>
    )

    await waitForOllama()
    await user.click(screen.getByRole('button', { name: 'LM Studio' }))
    rerender(
      <ProviderLibraryProvider>
        <div />
      </ProviderLibraryProvider>
    )
    rerender(
      <ProviderLibraryProvider>
        <SettingsMain />
      </ProviderLibraryProvider>
    )

    expect(await screen.findByRole('heading', { level: 2, name: 'LM Studio' })).toBeVisible()
  })

  it('loads persisted custom providers into the sidebar', async () => {
    providerApi.getLibrary.mockResolvedValue({
      configurations: [
        { provider: 'lm-studio', baseUrl: 'http://localhost:1234' },
        { provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: true }
      ],
      customProviders: [
        {
          apiFormat: 'openai-compatible',
          apiKey: 'secret',
          baseUrl: 'https://api.example.com/v1',
          headers: {},
          icon: 'default',
          id: 'example-ai',
          name: 'Example AI',
          useMaxCompletionTokens: false
        }
      ],
      models: [],
      selectedModelId: null
    })

    renderSettings()

    expect(await screen.findByRole('button', { name: 'Example AI' })).toBeVisible()
  })

  it('switches the empty provider section when a provider is selected', async () => {
    const user = userEvent.setup()

    renderSettings()

    await waitForOllama()
    expect(screen.getByRole('button', { name: 'Ollama' })).toHaveAttribute('aria-current', 'page')

    await user.click(screen.getByRole('button', { name: 'LM Studio' }))

    expect(screen.getByRole('heading', { level: 2, name: 'LM Studio' })).toBeVisible()
  })

  it('keeps connection and model controls visible while a provider is disabled', async () => {
    const user = userEvent.setup()

    renderSettings()

    await waitForOllama()
    expect(screen.getByLabelText('Base URL')).toBeVisible()
    expect(screen.getByRole('searchbox', { name: 'Search Ollama models' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Fetch Ollama models' }))

    expect(screen.getByLabelText('Ollama fetched models')).toBeVisible()
  })

  it('keeps enabled models and their order after refreshing a provider', async () => {
    persistedLibrary = {
      ...persistedLibrary,
      models: [
        {
          displayName: 'second-model',
          enabled: true,
          id: 'ollama:second-model',
          modelId: 'second-model',
          provider: 'ollama'
        },
        {
          displayName: 'first-model',
          enabled: true,
          id: 'ollama:first-model',
          modelId: 'first-model',
          provider: 'ollama'
        }
      ]
    }
    providerApi.discoverModels.mockResolvedValue([
      { modelId: 'first-model', displayName: 'First refreshed' },
      { modelId: 'second-model', displayName: 'Second refreshed' }
    ])
    const user = userEvent.setup()

    renderSettings()
    await waitForOllama()
    await user.click(screen.getByRole('button', { name: 'Fetch Ollama models' }))

    await waitFor(() => {
      const models = screen
        .getAllByRole('switch')
        .filter((control) =>
          ['Enable Saved First refreshed', 'Enable Saved Second refreshed'].includes(
            control.getAttribute('aria-label') ?? ''
          )
        )
      expect(models.map((control) => control.getAttribute('aria-label'))).toEqual([
        'Enable Saved Second refreshed',
        'Enable Saved First refreshed'
      ])
      expect(models[0]).toHaveAttribute('aria-checked', 'true')
      expect(models[1]).toHaveAttribute('aria-checked', 'true')
    })
  })

  it('places a newly enabled provider after previously enabled providers in the rail', async () => {
    const user = userEvent.setup()

    renderSettings()

    await waitForOllama()
    await user.click(screen.getByRole('button', { name: 'LM Studio' }))
    await user.click(screen.getByRole('switch', { name: 'Enable LM Studio' }))

    const providerButtons = screen
      .getAllByRole('button')
      .filter((button) => ['LM Studio', 'Ollama'].includes(button.getAttribute('aria-label') ?? ''))

    expect(providerButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Ollama',
      'LM Studio'
    ])
  })

  it('keeps provider rail order after enabling a model', async () => {
    const user = userEvent.setup()
    persistedLibrary = {
      configurations: [
        { provider: 'lm-studio', baseUrl: 'http://localhost:1234', enabled: true },
        { provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: true }
      ],
      customProviders: [],
      enabledProviderIds: ['ollama', 'lm-studio'],
      models: [
        {
          displayName: 'llama3.2',
          enabled: false,
          id: 'ollama-model',
          modelId: 'llama3.2',
          provider: 'ollama'
        }
      ],
      selectedModelId: null,
      selectedProviderId: 'ollama'
    }

    renderSettings()

    await screen.findByRole('heading', { level: 2, name: 'Ollama' })
    await user.click(screen.getByRole('switch', { name: 'Enable llama3.2' }))

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Enable llama3.2' })).toHaveAttribute(
        'aria-checked',
        'true'
      )
      const providerButtons = screen
        .getAllByRole('button')
        .filter((button) =>
          ['LM Studio', 'Ollama'].includes(button.getAttribute('aria-label') ?? '')
        )

      expect(providerButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
        'Ollama',
        'LM Studio'
      ])
    })
  })

  it('keeps provider configuration independent when switching providers', async () => {
    const user = userEvent.setup()

    renderSettings()

    await waitForOllama()
    await user.click(screen.getByRole('switch', { name: 'Enable Ollama' }))
    await user.click(screen.getByRole('button', { name: 'LM Studio' }))

    expect(screen.getByRole('switch', { name: 'Enable LM Studio' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(screen.getByLabelText('Base URL')).toHaveValue('http://localhost:1234')

    await user.click(screen.getByRole('switch', { name: 'Enable LM Studio' }))

    expect(screen.getByRole('switch', { name: 'Enable LM Studio' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  it('allows testing a fetched disabled model', async () => {
    const user = userEvent.setup()

    renderSettings()

    await waitForOllama()
    await user.click(screen.getByRole('button', { name: 'Fetch Ollama models' }))
    await screen.findByText('granite4.2:3b')
    await user.click(screen.getByRole('button', { name: 'Test Ollama model' }))

    const modelOption = screen.getByRole('option', { name: 'granite4.2:3b' })

    await user.click(modelOption)

    expect(await screen.findByText('granite4.2:3b is ready to use.')).toBeVisible()
  })

  it('disables model testing until the provider models are fetched', async () => {
    renderSettings()

    await waitForOllama()

    expect(screen.getByRole('button', { name: 'Test Ollama model' })).toBeDisabled()
  })

  it('filters fetched models through the models search input', async () => {
    const user = userEvent.setup()
    providerApi.discoverModels.mockResolvedValue([
      { modelId: 'granite4.2:3b', displayName: 'granite4.2:3b' },
      { modelId: 'llama3.2:latest', displayName: 'llama3.2:latest' }
    ])

    renderSettings()
    await waitForOllama()
    await user.click(screen.getByRole('button', { name: 'Fetch Ollama models' }))
    await screen.findByText('granite4.2:3b')
    await user.type(screen.getByRole('searchbox', { name: 'Search Ollama models' }), 'llama')

    expect(screen.getByText('llama3.2:latest')).toBeVisible()
    expect(screen.queryByText('granite4.2:3b')).not.toBeInTheDocument()
  })

  it('does not show one provider’s fetched models after switching to another provider', async () => {
    const user = userEvent.setup()

    renderSettings()

    await waitForOllama()
    await user.click(screen.getByRole('button', { name: 'Fetch Ollama models' }))
    await user.click(screen.getByRole('button', { name: 'LM Studio' }))

    expect(screen.getByLabelText('LM Studio fetched models')).toBeVisible()
    expect(screen.queryByText('granite4.2:3b')).not.toBeInTheDocument()
  })

  it('shows the provider error when model fetching fails', async () => {
    const user = userEvent.setup()
    providerApi.discoverModels.mockRejectedValue(new Error('Ollama is not running.'))

    renderSettings()

    await waitForOllama()
    await user.click(screen.getByRole('button', { name: 'Fetch Ollama models' }))

    expect(await screen.findByText('Ollama is not running.')).toBeVisible()
  })

  it('shows the provider error when a selected model cannot run', async () => {
    const user = userEvent.setup()
    providerApi.testModel.mockRejectedValue(new Error('The model is unavailable.'))

    renderSettings()
    await waitForOllama()
    await user.click(screen.getByRole('button', { name: 'Fetch Ollama models' }))
    await screen.findByText('granite4.2:3b')
    await user.click(screen.getByRole('button', { name: 'Test Ollama model' }))
    await user.click(screen.getByRole('option', { name: 'granite4.2:3b' }))

    expect(await screen.findByText('The model is unavailable.')).toBeVisible()
    expect(screen.getByLabelText('Ollama model test failed')).toBeVisible()
  })

  it('shows the model test lifecycle in the test control', async () => {
    const user = userEvent.setup()
    let finishTest: (() => void) | undefined
    providerApi.testModel.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishTest = resolve
        })
    )

    renderSettings()
    await waitForOllama()
    await user.click(screen.getByRole('button', { name: 'Fetch Ollama models' }))
    await screen.findByText('granite4.2:3b')
    await user.click(screen.getByRole('button', { name: 'Test Ollama model' }))
    await user.click(screen.getByRole('option', { name: 'granite4.2:3b' }))

    expect(screen.getByLabelText('Testing Ollama model')).toBeVisible()

    finishTest?.()

    expect(await screen.findByLabelText('Ollama model test succeeded')).toBeVisible()
  })

  it('filters the expanded provider rail by the entered provider name', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Search providers' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search providers' }), 'studio')

    expect(screen.getByRole('button', { name: 'LM Studio' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Ollama' })).not.toBeInTheDocument()
  })

  it('opens the provider search only after the search control is clicked', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.hover(screen.getByRole('navigation', { name: 'Providers' }))

    expect(screen.queryByRole('searchbox', { name: 'Search providers' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Search providers' }))

    expect(screen.getByRole('searchbox', { hidden: true, name: 'Search providers' })).toBeVisible()
  })

  it('collapses the provider rail after its search loses focus outside the rail', async () => {
    const user = userEvent.setup()

    renderSettings()

    const rail = screen.getByRole('navigation', { name: 'Providers' })
    await user.click(screen.getByRole('button', { name: 'Search providers' }))
    await user.unhover(rail)
    await user.click(screen.getByLabelText('Base URL'))

    await waitFor(() => {
      expect(screen.queryByRole('searchbox', { name: 'Search providers' })).not.toBeInTheDocument()
    })
  })

  it('opens the custom provider form', async () => {
    const user = userEvent.setup()

    renderSettings()

    await waitForOllama()
    await user.click(screen.getByRole('button', { name: 'Add custom provider' }))

    const dialog = screen.getByRole('dialog', { name: 'Add custom provider' })

    expect(dialog).toBeVisible()
    expect(screen.getByLabelText('Provider name')).toBeVisible()
    expect(screen.getByLabelText('Provider icon')).toBeVisible()
    expect(within(dialog).getByLabelText('Base URL')).toBeVisible()
    expect(screen.getByLabelText('API key (optional)')).toBeVisible()
    expect(screen.getByLabelText('API format')).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeVisible()
  })

  it('shows an example JSON header without pre-filling the custom provider form', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Add custom provider' }))

    expect(screen.getByLabelText('Custom headers (JSON)')).toHaveValue('')
    expect(screen.getByLabelText('Custom headers (JSON)')).toHaveAttribute(
      'placeholder',
      '{\n  "User-Agent": "Mico"\n}'
    )
  })

  it('adds a custom provider without headers when the headers field is left empty', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Add custom provider' }))
    const dialog = screen.getByRole('dialog', { name: 'Add custom provider' })
    await user.type(within(dialog).getByLabelText('Provider name'), 'Example AI')
    await user.type(within(dialog).getByLabelText('Base URL'), 'https://api.example.com/v1')
    await user.click(within(dialog).getByRole('button', { name: 'Add Provider' }))

    expect(screen.queryByRole('dialog', { name: 'Add custom provider' })).not.toBeInTheDocument()
  })

  it('selects a newly added custom provider and displays its fetched models', async () => {
    const user = userEvent.setup()
    providerApi.addCustomProvider.mockImplementation(async (provider) => {
      const saved = {
        ...provider,
        apiKey: 'secret',
        headers: { 'X-Client': 'Mico' },
        id: 'example-ai',
        useMaxCompletionTokens: true
      }
      persistedLibrary = { ...persistedLibrary, customProviders: [saved] }
      return saved
    })
    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Add custom provider' }))
    const dialog = screen.getByRole('dialog', { name: 'Add custom provider' })
    await user.type(within(dialog).getByLabelText('Provider name'), 'Example AI')
    await user.type(within(dialog).getByLabelText('Base URL'), 'https://api.example.com/v1')
    await user.click(within(dialog).getByRole('button', { name: 'Add Provider' }))

    expect(await screen.findByRole('button', { name: 'Example AI' })).toHaveAttribute(
      'aria-current',
      'page'
    )

    await user.click(screen.getByRole('button', { name: 'Fetch Example AI models' }))

    expect(await screen.findByText('granite4.2:3b')).toBeVisible()
  })

  it('edits a custom provider configuration from its details', async () => {
    const user = userEvent.setup()
    providerApi.addCustomProvider.mockImplementation(async (provider) => {
      const saved = {
        ...provider,
        apiKey: 'secret',
        headers: { 'X-Client': 'Mico' },
        id: 'example-ai',
        useMaxCompletionTokens: true
      }
      persistedLibrary = { ...persistedLibrary, customProviders: [saved] }
      return saved
    })
    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Add custom provider' }))
    const dialog = screen.getByRole('dialog', { name: 'Add custom provider' })
    await user.type(within(dialog).getByLabelText('Provider name'), 'Example AI')
    await user.type(within(dialog).getByLabelText('Base URL'), 'https://api.example.com/v1')
    await user.click(within(dialog).getByRole('button', { name: 'Add Provider' }))

    const apiKey = screen.getByLabelText('API Key (Optional)')
    expect(apiKey).toHaveAttribute('type', 'password')
    expect(apiKey).toHaveValue('')
    expect(screen.getByLabelText('Custom headers (JSON)')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'API format' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Show API key' }))

    expect(apiKey).toHaveAttribute('type', 'text')
  })

  it('removes a custom provider after confirmation', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Add custom provider' }))
    const dialog = screen.getByRole('dialog', { name: 'Add custom provider' })
    await user.type(within(dialog).getByLabelText('Provider name'), 'Example AI')
    await user.type(within(dialog).getByLabelText('Base URL'), 'https://api.example.com/v1')
    await user.click(within(dialog).getByRole('button', { name: 'Add Provider' }))

    await user.click(screen.getByRole('button', { name: 'Delete Example AI' }))
    await user.click(screen.getByRole('button', { name: 'Delete provider' }))

    expect(screen.queryByRole('button', { name: 'Example AI' })).not.toBeInTheDocument()
  })

  it('selects a custom provider icon from the icon menu', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Add custom provider' }))
    await user.click(screen.getByRole('button', { name: 'Default icon' }))

    const openAiOption = screen.getByRole('menuitemradio', { name: 'OpenAI' })
    expect(openAiOption).toHaveAttribute('aria-checked', 'false')

    await user.click(openAiOption)

    expect(screen.getByRole('button', { name: 'OpenAI' })).toBeVisible()
  })

  it('selects a custom provider API format from its menu', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Add custom provider' }))
    await user.click(screen.getByRole('button', { name: 'Chat Completions (/chat/completions)' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Responses (/responses)' }))

    expect(screen.getByRole('button', { name: 'Responses (/responses)' })).toBeVisible()
  })

  it('shows max completion tokens only for the Chat Completions API format', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Add custom provider' }))

    expect(screen.getByRole('switch', { name: 'Use max_completion_tokens' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Chat Completions (/chat/completions)' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Responses (/responses)' }))

    expect(
      screen.queryByRole('switch', { name: 'Use max_completion_tokens' })
    ).not.toBeInTheDocument()
  })

  it('reveals a provider icon name when its icon is hovered', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Add custom provider' }))
    await user.click(screen.getByRole('button', { name: 'Default icon' }))

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await user.hover(screen.getByRole('menuitemradio', { name: 'OpenAI' }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent('OpenAI')
  })

  it('expands the custom provider action into a labeled button with the provider rail', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Search providers' }))

    expect(screen.getByText('Custom Provider')).toBeVisible()
  })

  it('opens the custom provider dialog from the expanded rail action', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Search providers' }))
    await user.click(screen.getByText('Custom Provider'))

    expect(screen.getByRole('dialog', { name: 'Add custom provider' })).toBeVisible()
  })
})
