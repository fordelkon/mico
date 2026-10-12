import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProviderCatalog } from '@renderer/components/settings/providers/provider-library'
import { describe, expect, it } from 'vitest'

import { ChatModelSelector } from './chat-model-selector'

const library: ProviderCatalog = {
  configurations: {
    ollama: { apiKey: '', baseUrl: 'http://localhost:11434', enabled: true }
  },
  customProviders: [
    {
      id: 'example-ai',
      name: 'Example AI',
      apiFormat: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      headers: {},
      icon: 'zhipu',
      enabled: true
    }
  ],
  enabledProviderIds: ['ollama', 'example-ai'],
  enabledModelIds: ['ollama:qwen3', 'example-ai:chat'],
  models: [
    {
      enabled: true,
      id: 'ollama:qwen3',
      modelId: 'qwen3:8b',
      name: 'Qwen 3 8B',
      providerId: 'ollama'
    },
    {
      enabled: false,
      id: 'ollama:disabled',
      modelId: 'disabled',
      name: 'Disabled model',
      providerId: 'ollama'
    },
    {
      enabled: true,
      id: 'example-ai:chat',
      modelId: 'example-chat',
      name: 'Example Chat',
      providerId: 'example-ai'
    }
  ],
  selectedModelId: 'ollama:qwen3',
  selectedProviderId: null
}

function renderSelector(): void {
  render(<ChatModelSelector library={library} onSelect={() => undefined} />)
}

describe('ChatModelSelector', () => {
  it('user sees provider-grouped models when opening the selector, then disabled ones stay hidden', async () => {
    const user = userEvent.setup()
    renderSelector()

    await user.click(screen.getByRole('button', { name: 'Qwen 3 8B' }))

    expect(screen.getByText('Ollama')).toBeVisible()
    expect(screen.getByText('Example AI')).toBeVisible()
    expect(screen.getByRole('option', { name: 'Qwen 3 8B' })).toBeVisible()
    expect(screen.getByRole('option', { name: 'Example Chat' })).toBeVisible()
    expect(screen.getByText('qwen3:8b')).toBeVisible()
    expect(screen.getByText('example-chat')).toBeVisible()
    expect(screen.queryByText('Disabled model')).toBeNull()
  })

  it('user narrows the menu to eligible models when typing, then only matches remain', async () => {
    const user = userEvent.setup()
    renderSelector()

    await user.click(screen.getByRole('button', { name: 'Qwen 3 8B' }))
    const search = screen.getByPlaceholderText('Search models')
    await user.type(search, 'example')

    expect(search).toHaveValue('example')

    expect(screen.getByRole('option', { name: 'Example Chat' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'Qwen 3 8B' })).toBeNull()
  })

  it('user closes the selector when a model is chosen, then the listbox disappears', async () => {
    const user = userEvent.setup()
    renderSelector()

    await user.click(screen.getByRole('button', { name: 'Qwen 3 8B' }))
    await user.click(screen.getByRole('option', { name: 'Example Chat' }))

    expect(screen.queryByRole('listbox', { name: 'Available models' })).toBeNull()
  })

  it('user cannot open or choose models when the selector is disabled, then the trigger stays unavailable', () => {
    render(<ChatModelSelector library={library} disabled onSelect={() => undefined} />)

    expect(screen.getByRole('button', { name: 'Qwen 3 8B' })).toBeDisabled()
  })

  it('user navigates models when pressing arrows and ends, then focus reaches the list edges', async () => {
    const user = userEvent.setup()
    renderSelector()

    await user.click(screen.getByRole('button', { name: 'Qwen 3 8B' }))
    // Start in the query explicitly; opening also schedules its focus on the next frame.
    await user.click(screen.getByRole('textbox', { name: 'Search models' }))
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: 'Qwen 3 8B' })).toHaveFocus()

    await user.keyboard('{End}')
    expect(screen.getByRole('option', { name: 'Example Chat' })).toHaveFocus()

    await user.keyboard('{Home}')
    expect(screen.getByRole('option', { name: 'Qwen 3 8B' })).toHaveFocus()
  })
})
