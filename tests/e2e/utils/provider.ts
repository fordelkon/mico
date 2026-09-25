import { expect, type Page } from '@playwright/test'

export type ProviderEndpoint = {
  providerName: string
  baseUrl: string
  modelId: string
  apiFormat: 'openai-compatible' | 'anthropic-compatible' | 'openai-responses'
}

const apiFormatLabels = {
  'openai-compatible': 'Chat Completions (/chat/completions)',
  'openai-responses': 'Responses (/responses)',
  'anthropic-compatible': 'Anthropic Messages (v1/messages)'
} as const

/**
 * Create, enable, and give a model to a real provider entry — everything the
 * settings UI owns — then return to the chat page.
 */
export async function configureProvider(
  page: Page,
  endpoint: ProviderEndpoint,
  apiKey = ''
): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Ollama' })).toBeVisible()
  await page.getByRole('button', { name: 'Add custom provider' }).click()

  // The ollama section behind the dialog has its own "Base URL" field, so
  // scope every dialog field to the dialog itself.
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Provider name').fill(endpoint.providerName)
  await dialog.getByLabel('Base URL').fill(endpoint.baseUrl)
  const keyInput = dialog.getByLabel('API key (optional)')
  await expect(keyInput).toBeVisible()
  if (apiKey) {
    // Playwright renders fill(value) arguments in HTML reports. Evaluate does not
    // render its arguments; real-provider fixtures also disable raw context traces.
    // Use the native input setter so React still handles the real form update.
    await keyInput.evaluate((element, value) => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      if (!descriptor?.set) throw new Error('The provider API key field is unavailable.')
      descriptor.set.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }, apiKey)
  }

  if (endpoint.apiFormat !== 'openai-compatible') {
    // The dialog defaults to Chat Completions; switch the radio for Anthropic.
    await dialog.getByRole('button', { name: apiFormatLabels['openai-compatible'] }).click()
    await page.getByRole('menuitemradio', { name: apiFormatLabels[endpoint.apiFormat] }).click()
  }
  await dialog.getByRole('button', { name: 'Add Provider' }).click()

  await expect(page.getByRole('heading', { name: endpoint.providerName })).toBeVisible()
  await page.getByRole('switch', { name: `Enable ${endpoint.providerName}` }).click()

  await page.getByLabel(`Model ID for ${endpoint.providerName}`).fill(endpoint.modelId)
  await page.getByRole('button', { name: `Add ${endpoint.providerName} model` }).click()
  await page.getByRole('switch', { name: `Enable ${endpoint.modelId}` }).click()

  await page.getByRole('button', { name: 'Back' }).click()
}
