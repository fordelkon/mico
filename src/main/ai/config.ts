import { resolve } from 'node:path'

import { config as loadEnvironment } from 'dotenv'
import type { ChatProviderConfiguration } from '@mico/ai-providers'

type ChatConfiguration = ChatProviderConfiguration

class ChatConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatConfigurationError'
  }
}

function readChatConfiguration({
  isDevelopment,
  env
}: {
  isDevelopment: boolean
  env: NodeJS.ProcessEnv
}): ChatConfiguration {
  if (!isDevelopment) {
    throw new ChatConfigurationError('Chat is available only in development builds')
  }

  loadEnvironment({ path: resolve(process.cwd(), '.env'), quiet: true })

  const provider = env.MICO_AI_PROVIDER?.trim() ?? ''
  const baseUrl = env.MICO_AI_BASE_URL?.trim() ?? ''
  const apiKey = env.MICO_AI_API_KEY?.trim() ?? ''
  const modelId = env.MICO_AI_MODEL?.trim() ?? ''
  const missingVariables = [
    ['MICO_AI_PROVIDER', provider],
    ['MICO_AI_BASE_URL', baseUrl],
    ['MICO_AI_MODEL', modelId]
  ].flatMap(([name, value]) => (value ? [] : name))

  if (missingVariables.length > 0) {
    throw new ChatConfigurationError(
      `${missingVariables.join(', ').replace(/, ([^,]+)$/, ', and $1')} are required`
    )
  }

  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new ChatConfigurationError('MICO_AI_BASE_URL must be an absolute HTTP(S) URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ChatConfigurationError('MICO_AI_BASE_URL must be an absolute HTTP(S) URL')
  }

  if (
    ![
      'lm-studio',
      'openai-responses',
      'openai-compatible',
      'anthropic-compatible',
      'ollama'
    ].includes(provider)
  ) {
    throw new ChatConfigurationError(
      'MICO_AI_PROVIDER must be lm-studio, openai-responses, openai-compatible, anthropic-compatible, or ollama'
    )
  }

  if (provider === 'openai-responses') {
    if (!apiKey) throw new ChatConfigurationError('MICO_AI_API_KEY is required for OpenAI')
    return { provider, baseUrl, apiKey, modelId }
  }

  if (provider === 'anthropic-compatible') {
    if (!apiKey)
      throw new ChatConfigurationError(
        'MICO_AI_API_KEY is required for Anthropic-compatible providers'
      )
    return { provider, baseUrl, apiKey, modelId }
  }

  if (provider === 'openai-compatible') {
    return apiKey ? { provider, baseUrl, apiKey, modelId } : { provider, baseUrl, modelId }
  }

  if (provider === 'ollama') return { provider, baseUrl, modelId }

  if (apiKey) return { provider: 'lm-studio', baseUrl, modelId, apiKey }
  return { provider: 'lm-studio', baseUrl, modelId }
}

export { ChatConfigurationError, readChatConfiguration }
export type { ChatConfiguration }
