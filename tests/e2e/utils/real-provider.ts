import type { Page } from '@playwright/test'

import { expect } from '../fixtures/electron.fixture'

/**
 * Configuration for the optional real-provider profile, following Cherry
 * Studio's model: one shared API key, one base URL per protocol. Each
 * protocol's test is skipped unless its base URL and model are configured.
 *
 * - MICO_E2E_API_KEY                shared across protocols
 * - MICO_E2E_OPENAI_BASE_URL        e.g. https://api.openai.com/v1
 * - MICO_E2E_OPENAI_MODEL           e.g. gpt-4o-mini
 * - MICO_E2E_ANTHROPIC_BASE_URL     e.g. https://api.anthropic.com
 * - MICO_E2E_ANTHROPIC_MODEL        e.g. claude-haiku-4-5
 */
export const realApiKey = process.env['MICO_E2E_API_KEY'] ?? ''

export type RealEndpoint = {
  id: 'openai' | 'anthropic'
  providerName: string
  baseUrl: string
  modelId: string
  apiFormat: 'openai-compatible' | 'anthropic-compatible'
}

// SAFETY: these values flow only into UI fields the settings dialog accepts;
// the application validates the endpoint contract itself.
export const realEndpoints: RealEndpoint[] = [
  {
    id: 'openai',
    providerName: 'E2E OpenAI',
    baseUrl: process.env['MICO_E2E_OPENAI_BASE_URL'] ?? '',
    modelId: process.env['MICO_E2E_OPENAI_MODEL'] ?? '',
    apiFormat: 'openai-compatible'
  },
  {
    id: 'anthropic',
    providerName: 'E2E Anthropic',
    baseUrl: process.env['MICO_E2E_ANTHROPIC_BASE_URL'] ?? '',
    modelId: process.env['MICO_E2E_ANTHROPIC_MODEL'] ?? '',
    apiFormat: 'anthropic-compatible'
  }
]

export function isConfigured(endpoint: RealEndpoint): boolean {
  return Boolean(realApiKey && endpoint.baseUrl && endpoint.modelId)
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
export async function configureRealProvider(page: Page, endpoint: RealEndpoint): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Ollama' })).toBeVisible()
  await page.getByRole('button', { name: 'Add custom provider' }).click()

  // The ollama section behind the dialog has its own "Base URL" field, so
  // scope every dialog field to the dialog itself.
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Provider name').fill(endpoint.providerName)
  await dialog.getByLabel('Base URL').fill(endpoint.baseUrl)
  await dialog.getByLabel('API key (optional)').fill(realApiKey)

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
