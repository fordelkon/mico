import type { Page } from '@playwright/test'

import { configureProvider } from './provider'

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

/** Keep credentials confined to the opt-in real-provider profile. */
export async function configureRealProvider(page: Page, endpoint: RealEndpoint): Promise<void> {
  await configureProvider(page, endpoint, realApiKey)
}
