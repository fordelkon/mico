import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ProviderTestMenu } from './provider-test-menu'

describe('ProviderTestMenu', () => {
  it('passes the selected model identifier to the test action', async () => {
    const onTestModel = vi.fn()
    const user = userEvent.setup()
    render(
      <ProviderTestMenu
        hasModels
        isTesting={false}
        models={[
          {
            enabled: true,
            id: 'ollama:qwen3',
            modelId: 'qwen3:8b',
            name: 'Qwen 3 8B',
            providerId: 'ollama'
          }
        ]}
        onTestModel={onTestModel}
        providerLabel="Ollama"
        testState="idle"
      />
    )

    await user.click(screen.getByRole('button', { name: 'Test Ollama model' }))
    await user.click(screen.getByRole('option', { name: 'Qwen 3 8B' }))

    expect(onTestModel).toHaveBeenCalledWith('qwen3:8b')
  })

  it('closes the popover after a model is selected', async () => {
    const user = userEvent.setup()
    render(
      <ProviderTestMenu
        hasModels
        isTesting={false}
        models={[
          {
            enabled: true,
            id: 'ollama:qwen3',
            modelId: 'qwen3:8b',
            name: 'Qwen 3 8B',
            providerId: 'ollama'
          }
        ]}
        onTestModel={() => undefined}
        providerLabel="Ollama"
        testState="idle"
      />
    )

    await user.click(screen.getByRole('button', { name: 'Test Ollama model' }))
    await user.click(screen.getByRole('option', { name: 'Qwen 3 8B' }))

    expect(screen.queryByRole('listbox', { name: 'Ollama models' })).toBeNull()
  })
})
