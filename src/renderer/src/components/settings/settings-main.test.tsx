import '@testing-library/jest-dom/vitest'

import type { ProviderLibrary as PersistedProviderLibrary } from '@shared/data/schemas/provider'
import type { ProvidersAPI } from '@shared/ipc/schemas/providers'
import type { WindowControlsAPI } from '@shared/ipc/schemas/window-controls'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ProviderLibraryProvider,
  useProviderLibraryActions,
  useProviderLibraryState
} from './providers/provider-library'
import { SettingsMain } from './settings-main'

type CustomProvider = PersistedProviderLibrary['customProviders'][number]

const exampleAiCustomProvider: CustomProvider = {
  apiFormat: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  enabled: true,
  headers: {},
  icon: 'cloud',
  id: 'example-ai',
  name: 'Example AI'
}

function renderSettings(): void {
  render(
    <ProviderLibraryProvider>
      <SettingsMain />
    </ProviderLibraryProvider>
  )
}

function mockLibrary(selectedProviderId: string | null): void {
  providerApi.getLibrary.mockResolvedValueOnce({
    configurations: [{ provider: 'ollama', baseUrl: 'http://localhost:11434' }],
    customProviders: [],
    enabledProviderIds: ['ollama'],
    models: [],
    selectedModelId: null,
    selectedProviderId
  })
}

function mockAddExampleProvider(): void {
  providerApi.addCustomProvider.mockImplementation(async (provider) => {
    const saved = {
      ...provider,
      apiKey: 'secret',
      headers: { 'X-Client': 'Mico' },
      id: 'example-ai'
    }
    persistedLibrary = { ...persistedLibrary, customProviders: [saved] }
    return saved
  })
}

async function addExampleAiProvider(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Add custom provider' }))
  const dialog = screen.getByRole('dialog', { name: 'Add custom provider' })
  await user.type(within(dialog).getByLabelText('Provider name'), 'Example AI')
  await user.type(within(dialog).getByLabelText('Base URL'), 'https://api.example.com/v1')
  await user.click(within(dialog).getByRole('button', { name: 'Add Provider' }))
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
  addCustomProvider: vi.fn<ProvidersAPI['addCustomProvider']>(),
  addModel: vi.fn<ProvidersAPI['addModel']>(),
  discoverModels: vi.fn<ProvidersAPI['discoverModels']>(),
  getLibrary: vi.fn<ProvidersAPI['getLibrary']>(),
  saveLibrary: vi.fn<ProvidersAPI['saveLibrary']>(),
  importModel: vi.fn<ProvidersAPI['importModel']>(),
  removeCustomProvider: vi.fn<ProvidersAPI['removeCustomProvider']>(),
  removeModel: vi.fn<ProvidersAPI['removeModel']>(),
  saveConfiguration: vi.fn<ProvidersAPI['saveConfiguration']>(),
  selectProvider: vi.fn<ProvidersAPI['selectProvider']>(),
  setModelEnabled: vi.fn<ProvidersAPI['setModelEnabled']>(),
  syncModels: vi.fn<ProvidersAPI['syncModels']>(),
  testModel: vi.fn<ProvidersAPI['testModel']>(),
  updateCustomProvider: vi.fn<ProvidersAPI['updateCustomProvider']>()
}
const windowControlsApi = {
  onProviderDraftFlush: vi.fn<WindowControlsAPI['onProviderDraftFlush']>(() => () => undefined)
}

let persistedLibrary: PersistedProviderLibrary

beforeEach(() => {
  persistedLibrary = {
    configurations: [{ provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: true }],
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
  providerApi.addModel.mockReset()
  providerApi.addModel.mockImplementation(async ({ displayName, modelId, provider }) => {
    const saved = {
      displayName: displayName ?? modelId,
      enabled: false,
      id: `${provider}:${modelId}`,
      modelId,
      provider
    }
    if (!persistedLibrary.models.some((model) => model.id === saved.id))
      persistedLibrary = {
        ...persistedLibrary,
        models: [saved, ...persistedLibrary.models]
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
  providerApi.importModel.mockImplementation(async (model) => ({
    id: 'saved-model',
    enabled: false,
    ...model
  }))
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
  it('user lands on the Appearance page when opening it, then the heading is visible', () => {
    render(<SettingsMain page="appearance" />)

    expect(screen.getByRole('heading', { level: 1, name: 'Appearance' })).toBeVisible()
  })

  it('user keeps the library intact when Strict Mode hydrates, then saves never run', async () => {
    persistedLibrary = {
      ...persistedLibrary,
      customProviders: [exampleAiCustomProvider],
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

  it('user sees no save controls when settings render, then no Save button exists', () => {
    renderSettings()

    expect(screen.queryByText('All changes saved')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  it('user sees unrelated consumers stay still when selecting a provider, then no extra work runs', async () => {
    const user = userEvent.setup()
    const onRender = vi.fn<() => void>()
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

  it('user lands on the first provider when nothing is saved, then it is selected', async () => {
    mockLibrary(null)

    renderSettings()

    expect(await screen.findByRole('heading', { level: 2, name: 'Ollama' })).toBeVisible()
  })

  it('user returns to the last provider when a selection is saved, then it is restored', async () => {
    mockLibrary('ollama')

    renderSettings()

    expect(await screen.findByRole('heading', { level: 2, name: 'Ollama' })).toBeVisible()
  })

  it('user falls back to the first provider when the selection is gone, then it opens', async () => {
    mockLibrary('missing-custom-provider')

    renderSettings()

    expect(await screen.findByRole('heading', { level: 2, name: 'Ollama' })).toBeVisible()
  })

  it('user sees the last provider when returning to settings, then it is restored', async () => {
    const { rerender } = render(
      <ProviderLibraryProvider>
        <SettingsMain />
      </ProviderLibraryProvider>
    )

    await waitForOllama()
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

    expect(await screen.findByRole('heading', { level: 2, name: 'Ollama' })).toBeVisible()
  })

  it('user sees custom providers when the library loads, then they appear as buttons', async () => {
    providerApi.getLibrary.mockResolvedValue({
      configurations: [{ provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: true }],
      customProviders: [
        {
          apiFormat: 'openai-compatible',
          apiKey: 'secret',
          baseUrl: 'https://api.example.com/v1',
          headers: {},
          icon: 'default',
          id: 'example-ai',
          name: 'Example AI'
        }
      ],
      enabledProviderIds: ['ollama'],
      models: [],
      selectedModelId: null,
      selectedProviderId: null
    })

    renderSettings()

    expect(await screen.findByRole('button', { name: 'Example AI' })).toBeVisible()
  })

  it('user sees provider and model controls when disabled, then fetching reveals them', async () => {
    const user = userEvent.setup()

    renderSettings()

    await waitForOllama()
    expect(screen.getByLabelText('Base URL')).toBeVisible()
    expect(screen.getByRole('searchbox', { name: 'Search Ollama models' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Fetch Ollama models' }))

    expect(screen.getByLabelText('Ollama fetched models')).toBeVisible()
  })

  it('user sees no Model ID when a built-in provider is chosen, then it stays absent', async () => {
    renderSettings()

    await waitForOllama()
    expect(screen.queryByLabelText('Model ID for Ollama')).not.toBeInTheDocument()
  })

  it('user adds a manual model when submitting, then it is saved disabled and cleared', async () => {
    persistedLibrary = {
      ...persistedLibrary,
      customProviders: [exampleAiCustomProvider],
      selectedProviderId: 'example-ai'
    }
    const user = userEvent.setup()
    renderSettings()

    await screen.findByRole('heading', { level: 2, name: 'Example AI' })
    const modelId = screen.getByLabelText('Model ID for Example AI')
    const displayName = screen.getByLabelText('Display name for Example AI')
    await user.type(modelId, ' manual-model ')
    await user.type(displayName, ' Manual model ')
    await user.click(screen.getByRole('button', { name: 'Add Example AI model' }))

    await waitFor(() =>
      expect(providerApi.addModel).toHaveBeenCalledWith({
        displayName: 'Manual model',
        modelId: 'manual-model',
        provider: 'example-ai'
      })
    )
    expect(modelId).toHaveValue('')
    expect(displayName).toHaveValue('')
    expect(await screen.findByRole('switch', { name: 'Enable Manual model' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('user keeps enabled models in order when refreshing, then none are disabled', async () => {
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

  it('user keeps the rail order when enabling a model, then it toggles on in place', async () => {
    const user = userEvent.setup()
    persistedLibrary = {
      configurations: [{ provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: true }],
      customProviders: [],
      enabledProviderIds: ['ollama'],
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
        .filter((button) => button.getAttribute('aria-label') === 'Ollama')

      expect(providerButtons.map((button) => button.getAttribute('aria-label'))).toEqual(['Ollama'])
    })
  })

  it('user tests a disabled model when choosing it, then it reports ready to use', async () => {
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

  it('user cannot test models when none are fetched, then the control stays disabled', async () => {
    renderSettings()

    await waitForOllama()

    expect(screen.getByRole('button', { name: 'Test Ollama model' })).toBeDisabled()
  })

  it('user filters fetched models when typing in search, then only matches remain', async () => {
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

  it('user sees the provider error when model fetching fails, then it is displayed', async () => {
    const user = userEvent.setup()
    providerApi.discoverModels.mockRejectedValue(new Error('Ollama is not running.'))

    renderSettings()

    await waitForOllama()
    await user.click(screen.getByRole('button', { name: 'Fetch Ollama models' }))

    expect(await screen.findByText('Ollama is not running.')).toBeVisible()
  })

  it('user sees the provider error when a model test fails, then the failure is shown', async () => {
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

  it('user sees the test control when a test runs, then it shows testing and success', async () => {
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

  it('user filters the provider rail when entering a name, then matches stay visible', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Search providers' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search providers' }), 'ollama')

    expect(screen.getByRole('button', { name: 'Ollama' })).toBeVisible()
  })

  it('user opens the search when clicking it, then hovering does not reveal it', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.hover(screen.getByRole('navigation', { name: 'Providers' }))

    expect(screen.queryByRole('searchbox', { name: 'Search providers' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Search providers' }))

    expect(screen.getByRole('searchbox', { hidden: true, name: 'Search providers' })).toBeVisible()
  })

  it('user collapses the rail when its search loses focus, then the search box goes', async () => {
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

  it('user opens the custom form when clicking Add custom provider, then fields appear', async () => {
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

  it('user sees a JSON placeholder when opening the form, then headers stay empty', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Add custom provider' }))

    expect(screen.getByLabelText('Custom headers (JSON)')).toHaveValue('')
    expect(screen.getByLabelText('Custom headers (JSON)')).toHaveAttribute(
      'placeholder',
      '{\n  "User-Agent": "Mico"\n}'
    )
  })

  it('user adds a custom provider with no headers when empty, then the dialog closes', async () => {
    const user = userEvent.setup()

    renderSettings()

    await addExampleAiProvider(user)

    expect(screen.queryByRole('dialog', { name: 'Add custom provider' })).not.toBeInTheDocument()
  })

  it('user lands on the new custom provider when adding it, then its models appear', async () => {
    const user = userEvent.setup()
    mockAddExampleProvider()
    renderSettings()

    await addExampleAiProvider(user)

    expect(await screen.findByRole('button', { name: 'Example AI' })).toHaveAttribute(
      'aria-current',
      'page'
    )

    await user.click(screen.getByRole('button', { name: 'Fetch Example AI models' }))

    expect(await screen.findByText('granite4.2:3b')).toBeVisible()
  })

  it('user edits a custom provider when opening it, then the API key can be revealed', async () => {
    const user = userEvent.setup()
    mockAddExampleProvider()
    renderSettings()

    await addExampleAiProvider(user)

    const apiKey = screen.getByLabelText('API Key (Optional)')
    expect(apiKey).toHaveAttribute('type', 'password')
    expect(apiKey).toHaveValue('')
    expect(screen.getByLabelText('Custom headers (JSON)')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'API format' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Show API key' }))

    expect(apiKey).toHaveAttribute('type', 'text')
  })

  it('user removes a provider when confirming, then it disappears from the sidebar', async () => {
    const user = userEvent.setup()

    renderSettings()

    await addExampleAiProvider(user)

    await user.click(screen.getByRole('button', { name: 'Delete Example AI' }))
    await user.click(screen.getByRole('button', { name: 'Delete provider' }))

    expect(screen.queryByRole('button', { name: 'Example AI' })).not.toBeInTheDocument()
  })

  it('user selects a provider icon when choosing from the menu, then it is applied', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Add custom provider' }))
    await user.click(screen.getByRole('button', { name: 'Default icon' }))

    const lmStudioOption = screen.getByRole('menuitemradio', { name: 'LM Studio' })
    expect(lmStudioOption).toHaveAttribute('aria-checked', 'false')

    await user.click(lmStudioOption)

    expect(screen.getByRole('button', { name: 'LM Studio' })).toBeVisible()
  })

  it('user selects an API format when choosing from its menu, then it is applied', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Add custom provider' }))
    await user.click(screen.getByRole('button', { name: 'Chat Completions (/chat/completions)' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Responses (/responses)' }))

    expect(screen.getByRole('button', { name: 'Responses (/responses)' })).toBeVisible()
  })

  it('user sees an icon name when hovering it, then a tooltip reveals the name', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Add custom provider' }))
    await user.click(screen.getByRole('button', { name: 'Default icon' }))

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await user.hover(screen.getByRole('menuitemradio', { name: 'OpenAI' }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent('OpenAI')
  })

  it('user sees the custom action labeled when the rail expands, then the label shows', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Search providers' }))

    expect(screen.getByText('Custom Provider')).toBeVisible()
  })

  it('user opens the custom dialog when clicking the expanded action, then it appears', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Search providers' }))
    await user.click(screen.getByText('Custom Provider'))

    expect(screen.getByRole('dialog', { name: 'Add custom provider' })).toBeVisible()
  })
})
