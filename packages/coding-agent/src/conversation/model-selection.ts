import type { ChatProvider, ChatProviderConfiguration } from '@mico/ai-providers'

/**
 * Everything one model step needs: the provider instance, the connection
 * configuration that produced it, and the model entry backing the request.
 */
type ModelSelection = {
  provider: Pick<ChatProvider, 'getModelCapabilities' | 'stream'>
  configuration: ChatProviderConfiguration
  modelEntryId: string
}

/** No enabled model backs the requested profile or the global selection. */
class ModelSelectionError extends Error {
  constructor(message = 'Select an enabled model in Settings before chatting.') {
    super(message)
  }
}

export { ModelSelectionError }
export type { ModelSelection }
