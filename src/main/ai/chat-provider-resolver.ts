import type { ChatProvider, ChatProviderConfiguration } from '@mico/ai-providers'

type ChatProviderResolver = () => Pick<ChatProvider, 'getModelCapabilities' | 'stream'> | null

function createChatProviderResolver({
  getSelectedChatConfiguration,
  createChatProvider
}: {
  getSelectedChatConfiguration: () => ChatProviderConfiguration | null
  createChatProvider: (
    configuration: ChatProviderConfiguration
  ) => Pick<ChatProvider, 'getModelCapabilities' | 'stream'>
}): ChatProviderResolver {
  let cachedConfigurationKey: string | null = null
  let cachedProvider: Pick<ChatProvider, 'getModelCapabilities' | 'stream'> | null = null

  return () => {
    const configuration = getSelectedChatConfiguration()
    if (!configuration) {
      cachedConfigurationKey = null
      cachedProvider = null
      return null
    }

    const configurationKey = JSON.stringify(configuration)
    if (cachedConfigurationKey !== configurationKey || !cachedProvider) {
      cachedConfigurationKey = configurationKey
      cachedProvider = createChatProvider(configuration)
    }
    return cachedProvider
  }
}

export { createChatProviderResolver }
export type { ChatProviderResolver }
