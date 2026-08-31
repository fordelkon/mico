import { resolve } from 'node:path'

import { config as loadEnvironment } from 'dotenv'

type ChatConfiguration = {
  baseUrl: string
  apiKey: string
  modelId: string
}

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

  const baseUrl = env.MICO_AI_BASE_URL?.trim() ?? ''
  const apiKey = env.MICO_AI_API_KEY?.trim() ?? ''
  const modelId = env.MICO_AI_MODEL?.trim() ?? ''
  const missingVariables = [
    ['MICO_AI_BASE_URL', baseUrl],
    ['MICO_AI_API_KEY', apiKey],
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

  return { baseUrl, apiKey, modelId }
}

export { ChatConfigurationError, readChatConfiguration }
export type { ChatConfiguration }
