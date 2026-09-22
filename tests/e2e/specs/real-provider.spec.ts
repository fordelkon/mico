import { expect, test } from '../fixtures/electron.fixture'
import { waitForAppReady } from '../utils/wait-helpers'

/**
 * Optional profile against real LLM endpoints, following Cherry Studio's
 * model: one shared API key, one base URL per protocol. Each protocol is a
 * separate provider entry created through the settings UI, and its test is
 * skipped unless that protocol's endpoint is configured:
 *
 * - MICO_E2E_API_KEY                shared across protocols
 * - MICO_E2E_OPENAI_BASE_URL        e.g. https://api.openai.com/v1
 * - MICO_E2E_OPENAI_MODEL           e.g. gpt-4o-mini
 * - MICO_E2E_ANTHROPIC_BASE_URL     e.g. https://api.anthropic.com
 * - MICO_E2E_ANTHROPIC_MODEL        e.g. claude-haiku-4-5
 *
 * Credentials stay in the environment, are entered through the settings UI
 * like a user would, and the key field is password-masked so failure
 * screenshots never expose them.
 */
const apiKey = process.env['MICO_E2E_API_KEY'] ?? ''

// SAFETY: these values flow only into UI fields the settings dialog accepts;
// the application validates the endpoint contract itself.
const endpoints = [
  {
    id: 'openai',
    providerName: 'E2E OpenAI',
    baseUrl: process.env['MICO_E2E_OPENAI_BASE_URL'] ?? '',
    modelId: process.env['MICO_E2E_OPENAI_MODEL'] ?? '',
    apiFormat: 'openai-compatible' as const
  },
  {
    id: 'anthropic',
    providerName: 'E2E Anthropic',
    baseUrl: process.env['MICO_E2E_ANTHROPIC_BASE_URL'] ?? '',
    modelId: process.env['MICO_E2E_ANTHROPIC_MODEL'] ?? '',
    apiFormat: 'anthropic-compatible' as const
  }
]

const apiFormatLabels = {
  'openai-compatible': 'Chat Completions (/chat/completions)',
  'openai-responses': 'Responses (/responses)',
  'anthropic-compatible': 'Anthropic Messages (v1/messages)'
} as const

test.describe('Real provider chat', () => {
  for (const endpoint of endpoints) {
    const configured = Boolean(apiKey && endpoint.baseUrl && endpoint.modelId)

    test(`user gets a reply when chatting through the ${endpoint.id} endpoint, then the assistant answers`, async ({
      mainWindow
    }) => {
      test.skip(!configured, `Set MICO_E2E_API_KEY with the ${endpoint.id} base URL and model`)

      await waitForAppReady(mainWindow)

      await mainWindow.getByRole('button', { name: 'Settings' }).click()
      await expect(mainWindow.getByRole('heading', { name: 'Ollama' })).toBeVisible()
      await mainWindow.getByRole('button', { name: 'Add custom provider' }).click()

      // The ollama section behind the dialog has its own "Base URL" field, so
      // scope every dialog field to the dialog itself.
      const dialog = mainWindow.getByRole('dialog')
      await dialog.getByLabel('Provider name').fill(endpoint.providerName)
      await dialog.getByLabel('Base URL').fill(endpoint.baseUrl)
      await dialog.getByLabel('API key (optional)').fill(apiKey)

      if (endpoint.apiFormat !== 'openai-compatible') {
        // The dialog defaults to Chat Completions; switch the radio for Anthropic.
        await dialog.getByRole('button', { name: apiFormatLabels['openai-compatible'] }).click()
        await mainWindow
          .getByRole('menuitemradio', { name: apiFormatLabels[endpoint.apiFormat] })
          .click()
      }
      await dialog.getByRole('button', { name: 'Add Provider' }).click()

      await expect(mainWindow.getByRole('heading', { name: endpoint.providerName })).toBeVisible()
      await mainWindow.getByRole('switch', { name: `Enable ${endpoint.providerName}` }).click()

      await mainWindow.getByLabel(`Model ID for ${endpoint.providerName}`).fill(endpoint.modelId)
      await mainWindow.getByRole('button', { name: `Add ${endpoint.providerName} model` }).click()
      await mainWindow.getByRole('switch', { name: `Enable ${endpoint.modelId}` }).click()

      await mainWindow.getByRole('button', { name: 'Back' }).click()
      await mainWindow.getByRole('button', { name: 'Select model' }).click()
      await mainWindow.getByRole('option', { name: endpoint.modelId }).click()
      await expect(mainWindow.getByRole('textbox', { name: 'Search models' })).toBeHidden()

      await mainWindow.getByRole('textbox').click()
      await mainWindow.getByRole('textbox').fill('Reply with the single word: OK.')
      await mainWindow.getByRole('button', { name: 'Send message' }).click()

      // The reply text is model-controlled, so assert a second message appears
      // and streams to non-empty text instead of matching exact wording.
      const messages = mainWindow.locator('[data-slot="message"]')
      await expect(messages).toHaveCount(2)
      await expect(messages.last()).toContainText(/\S/)
    })
  }
})
