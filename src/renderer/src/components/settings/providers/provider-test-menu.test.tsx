import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ProviderTestMenu } from './provider-test-menu'

describe('ProviderTestMenu', () => {
  it('user passes the selected model id when picking one, then the popover closes', async () => {
    const onTestModel = vi.fn<(modelId: string) => void>()
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

    expect(onTestModel).toHaveBeenCalledOnce()
    expect(onTestModel).toHaveBeenCalledWith('qwen3:8b')
    expect(screen.queryByRole('listbox', { name: 'Ollama models' })).toBeNull()
  })

  it('user cannot open the menu when no models exist, then the trigger is disabled', async () => {
    const user = userEvent.setup()

    render(
      <ProviderTestMenu
        hasModels={false}
        isTesting={false}
        models={[]}
        onTestModel={vi.fn<(modelId: string) => void>()}
        providerLabel="Ollama"
        testState="idle"
      />
    )

    const trigger = screen.getByRole('button', { name: 'Test Ollama model' })
    expect(trigger).toBeDisabled()

    await user.click(trigger)

    expect(screen.queryByRole('listbox', { name: 'Ollama models' })).not.toBeInTheDocument()
  })
})
