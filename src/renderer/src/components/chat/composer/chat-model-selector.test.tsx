import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProviderLibrary } from '@shared/data/schemas/provider'
import { describe, expect, it } from 'vitest'

import { ChatModelSelector } from './chat-model-selector'

const library: ProviderLibrary = {
  configurations: [{ provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: true }],
  customProviders: [
    {
      id: 'example-ai',
      name: 'Example AI',
      apiFormat: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      headers: {},
      icon: 'zhipu',
      useMaxCompletionTokens: true,
      enabled: true
    }
  ],
  enabledProviderIds: ['ollama', 'example-ai'],
  models: [
    {
      id: 'ollama:qwen3',
      provider: 'ollama',
      modelId: 'qwen3:8b',
      displayName: 'Qwen 3 8B',
      enabled: true
    },
    {
      id: 'ollama:disabled',
      provider: 'ollama',
      modelId: 'disabled',
      displayName: 'Disabled model',
      enabled: false
    },
    {
      id: 'example-ai:chat',
      provider: 'example-ai',
      modelId: 'example-chat',
      displayName: 'Example Chat',
      enabled: true
    }
  ],
  selectedModelId: 'ollama:qwen3',
  selectedProviderId: null
}

describe('ChatModelSelector', () => {
  it('shows enabled models and their identifiers grouped by provider', async () => {
    const user = userEvent.setup()
    render(<ChatModelSelector library={library} onSelect={() => undefined} />)

    await user.click(screen.getByRole('button', { name: 'Qwen 3 8B' }))

    expect(screen.getByText('Ollama')).toBeVisible()
    expect(screen.getByText('Example AI')).toBeVisible()
    expect(screen.getByRole('option', { name: 'Qwen 3 8B' })).toBeVisible()
    expect(screen.getByRole('option', { name: 'Example Chat' })).toBeVisible()
    expect(screen.getByText('qwen3:8b')).toBeVisible()
    expect(screen.getByText('example-chat')).toBeVisible()
    expect(screen.queryByText('Disabled model')).toBeNull()
  })

  it('limits the menu to eligible models matching the search query', async () => {
    const user = userEvent.setup()
    render(<ChatModelSelector library={library} onSelect={() => undefined} />)

    await user.click(screen.getByRole('button', { name: 'Qwen 3 8B' }))
    const search = screen.getByPlaceholderText('Search models')
    await user.type(search, 'example')

    expect(search).toHaveValue('example')

    expect(screen.getByRole('option', { name: 'Example Chat' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'Qwen 3 8B' })).toBeNull()
  })

  it('closes the selector after a model is selected', async () => {
    const user = userEvent.setup()
    render(<ChatModelSelector library={library} onSelect={() => undefined} />)

    await user.click(screen.getByRole('button', { name: 'Qwen 3 8B' }))
    await user.click(screen.getByRole('option', { name: 'Example Chat' }))

    expect(screen.queryByRole('listbox', { name: 'Available models' })).toBeNull()
  })
})
