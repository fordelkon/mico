import '@testing-library/jest-dom/vitest'

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsMain } from './settings-main'
import { ProviderLibraryProvider } from './providers/provider-library'

function renderSettings(): void {
  render(
    <ProviderLibraryProvider>
      <SettingsMain />
    </ProviderLibraryProvider>
  )
}

async function waitForOllama(): Promise<void> {
  await screen.findByRole('heading', { level: 2, name: 'Ollama' })
}

const providerApi = {
  addCustomProvider: vi.fn(),
  discoverModels: vi.fn(),
  getLibrary: vi.fn(),
  importModel: vi.fn(),
  removeCustomProvider: vi.fn(),
  removeModel: vi.fn(),
  saveConfiguration: vi.fn(),
  saveLibrary: vi.fn(),
  selectProvider: vi.fn(),
  setModelEnabled: vi.fn(),
  syncModels: vi.fn(),
  testModel: vi.fn(),
  updateCustomProvider: vi.fn()
}

beforeEach(() => {
  let persistedModels: Array<{
    displayName: string
    enabled: boolean
    id: string
    modelId: string
    provider: string
  }> = []
  providerApi.addCustomProvider.mockReset()
  providerApi.addCustomProvider.mockResolvedValue({
    configurations: [
      { provider: 'lm-studio', baseUrl: 'http://localhost:1234' },
      { provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: true }
    ],
    customProviders: [
      {
        apiFormat: 'openai-compatible',
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
  providerApi.getLibrary.mockReset()
  providerApi.getLibrary.mockResolvedValue({
    configurations: [
      { provider: 'lm-studio', baseUrl: 'http://localhost:1234' },
      { provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: true }
    ],
    customProviders: [],
    models: [],
    selectedModelId: null,
    selectedProviderId: null
  })
  providerApi.selectProvider.mockReset()
  providerApi.selectProvider.mockResolvedValue({
    configurations: [
      { provider: 'lm-studio', baseUrl: 'http://localhost:1234' },
      { provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: true }
    ],
    customProviders: [],
    models: [],
    selectedModelId: null,
    selectedProviderId: null
  })
  providerApi.discoverModels.mockReset()
  providerApi.discoverModels.mockResolvedValue([
    { modelId: 'granite4.2:3b', displayName: 'granite4.2:3b' }
  ])
  providerApi.removeCustomProvider.mockReset()
  providerApi.removeCustomProvider.mockResolvedValue({
    configurations: [
      { provider: 'lm-studio', baseUrl: 'http://localhost:1234' },
      { provider: 'ollama', baseUrl: 'http://localhost:11434' }
    ],
    customProviders: [],
    models: [],
    selectedModelId: null
  })
  providerApi.updateCustomProvider.mockReset()
  providerApi.updateCustomProvider.mockImplementation(async (provider) => {
    if (provider.apiKey === '') throw new Error('Invalid custom provider')

    return {
      configurations: [
        { provider: 'lm-studio', baseUrl: 'http://localhost:1234' },
        { provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: true }
      ],
      customProviders: [provider],
      models: [],
      selectedModelId: null
    }
  })
  providerApi.testModel.mockReset()
  providerApi.testModel.mockResolvedValue(undefined)
  providerApi.saveLibrary.mockReset()
  providerApi.saveLibrary.mockImplementation(async (library) => library)
  providerApi.saveConfiguration.mockReset()
  providerApi.saveConfiguration.mockImplementation(async (configuration) => ({
    configurations: [{ provider: 'lm-studio', baseUrl: 'http://localhost:1234' }, configuration],
    customProviders: [],
    models: [],
    selectedModelId: null
  }))
  providerApi.importModel.mockReset()
  providerApi.importModel.mockImplementation(async (model) => ({
    configurations: [
      { provider: 'lm-studio', baseUrl: 'http://localhost:1234' },
      { provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: true }
    ],
    customProviders: [],
    models: [{ id: 'saved-model', ...model }],
    selectedModelId: null
  }))
  providerApi.removeModel.mockReset()
  providerApi.removeModel.mockResolvedValue({
    configurations: [],
    customProviders: [],
    models: [],
    selectedModelId: null
  })
  providerApi.syncModels.mockReset()
  providerApi.syncModels.mockImplementation(async ({ models, provider }) => {
    persistedModels = models.map(({ displayName, modelId }) => {
      const existing = persistedModels.find((model) => model.modelId === modelId)
      return {
        displayName,
        enabled: existing?.enabled ?? false,
        id: existing?.id ?? `${provider}:${modelId}`,
        modelId,
        provider
      }
    })
    return {
      configurations: [
        { provider: 'lm-studio', baseUrl: 'http://localhost:1234' },
        { provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: true }
      ],
      customProviders: [],
      models: persistedModels,
      selectedModelId: null
    }
  })
  providerApi.setModelEnabled.mockReset()
  providerApi.setModelEnabled.mockImplementation(async ({ enabled, modelId }) => {
    persistedModels = persistedModels.map((model) =>
      model.id === modelId ? { ...model, enabled } : model
    )
    return {
      configurations: [
        { provider: 'lm-studio', baseUrl: 'http://localhost:1234' },
        { provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: true }
      ],
      customProviders: [],
      models: persistedModels,
      selectedModelId: null
    }
  })
  Object.defineProperty(window, 'api', { configurable: true, value: { providers: providerApi } })
})

describe('SettingsMain', () => {
  it('does not render manual save controls', () => {
    renderSettings()

    expect(screen.queryByText('All changes saved')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
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
    await waitFor(() => {
      expect(providerApi.selectProvider).toHaveBeenCalledWith('lm-studio')
    })
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

    const modelOption = screen.getByRole('menuitem', { name: 'granite4.2:3b' })

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
    await user.click(screen.getByRole('menuitem', { name: 'granite4.2:3b' }))

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
    await user.click(screen.getByRole('menuitem', { name: 'granite4.2:3b' }))

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
    providerApi.addCustomProvider.mockResolvedValue({
      configurations: [
        { provider: 'lm-studio', baseUrl: 'http://localhost:1234' },
        { provider: 'ollama', baseUrl: 'http://localhost:11434' }
      ],
      customProviders: [
        {
          apiFormat: 'openai-compatible',
          apiKey: 'secret',
          baseUrl: 'https://api.example.com/v1',
          headers: { 'X-Client': 'Mico' },
          icon: 'default',
          id: 'example-ai',
          name: 'Example AI',
          useMaxCompletionTokens: true
        }
      ],
      models: [],
      selectedModelId: null
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
    providerApi.addCustomProvider.mockResolvedValue({
      configurations: [
        { provider: 'lm-studio', baseUrl: 'http://localhost:1234' },
        { provider: 'ollama', baseUrl: 'http://localhost:11434' }
      ],
      customProviders: [
        {
          apiFormat: 'openai-compatible',
          apiKey: 'secret',
          baseUrl: 'https://api.example.com/v1',
          headers: { 'X-Client': 'Mico' },
          icon: 'default',
          id: 'example-ai',
          name: 'Example AI',
          useMaxCompletionTokens: true
        }
      ],
      models: [],
      selectedModelId: null
    })
    renderSettings()

    await user.click(screen.getByRole('button', { name: 'Add custom provider' }))
    const dialog = screen.getByRole('dialog', { name: 'Add custom provider' })
    await user.type(within(dialog).getByLabelText('Provider name'), 'Example AI')
    await user.type(within(dialog).getByLabelText('Base URL'), 'https://api.example.com/v1')
    await user.click(within(dialog).getByRole('button', { name: 'Add Provider' }))

    const apiKey = screen.getByLabelText('API Key (Optional)')
    expect(apiKey).toHaveAttribute('type', 'password')
    expect(apiKey).toHaveValue('secret')
    expect(screen.getByLabelText('Custom headers (JSON)')).toHaveValue('{\n  "X-Client": "Mico"\n}')
    expect(
      screen.getByRole('button', { name: 'Chat Completions (/chat/completions)' })
    ).toBeVisible()

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
