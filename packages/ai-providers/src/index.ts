import type { ChatProvider, ChatProviderConfiguration, ChatProviderDependencies } from './contracts'
import { createLMStudioProvider } from './adapters/lm-studio'
import { createOpenAIResponsesProvider } from './adapters/openai-responses'
import { createOpenAICompatibleProvider } from './adapters/openai-compatible'
import { createAnthropicCompatibleProvider } from './adapters/anthropic-compatible'
import { createOllamaProvider } from './adapters/ollama'

const defaultDependencies: ChatProviderDependencies = {
  fetch,
  createId: () => crypto.randomUUID()
}

function createChatProvider(
  configuration: ChatProviderConfiguration,
  dependencies: ChatProviderDependencies = defaultDependencies
): ChatProvider {
  switch (configuration.provider) {
    case 'lm-studio':
      return createLMStudioProvider(configuration, dependencies)
    case 'openai-responses':
      return createOpenAIResponsesProvider(configuration, dependencies)
    case 'openai-compatible':
      return createOpenAICompatibleProvider(configuration, dependencies)
    case 'anthropic-compatible':
      return createAnthropicCompatibleProvider(configuration, dependencies)
    case 'ollama':
      return createOllamaProvider(configuration, dependencies)
  }
}

export { createChatProvider }
export type {
  ChatProvider,
  ChatProviderConfiguration,
  ChatProviderDependencies,
  ChatProviderMessage,
  ChatProviderStreamInput,
  ModelReasoningCapabilities,
  ThinkingSelection
} from './contracts'
