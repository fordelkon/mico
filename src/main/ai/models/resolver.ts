import type { ChatProvider, ChatProviderConfiguration } from '@mico/ai-providers'

type ModelResolver = (
  modelEntryId?: string
) => Pick<ChatProvider, 'getModelCapabilities' | 'stream'> | null

function createModelResolver({
  getChatConfigurationForModelEntry,
  createChatProvider
}: {
  getChatConfigurationForModelEntry: (modelEntryId: string) => ChatProviderConfiguration | null
  createChatProvider: (
    configuration: ChatProviderConfiguration
  ) => Pick<ChatProvider, 'getModelCapabilities' | 'stream'>
}): ModelResolver {
  const cachedProviders = new Map<string, Pick<ChatProvider, 'getModelCapabilities' | 'stream'>>()

  return (modelEntryId) => {
    if (!modelEntryId) return null
    const configuration = getChatConfigurationForModelEntry(modelEntryId)
    if (!configuration) return null

    const configurationKey = JSON.stringify(configuration)
    const cachedProvider = cachedProviders.get(configurationKey)
    if (cachedProvider) return cachedProvider
    const provider = createChatProvider(configuration)
    cachedProviders.set(configurationKey, provider)
    return provider
  }
}

export { createModelResolver }
export type { ModelResolver }
