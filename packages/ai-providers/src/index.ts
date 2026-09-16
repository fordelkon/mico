import type { ChatProvider, ChatProviderConfiguration, ChatProviderDependencies } from './contracts'
import { createOpenAIResponsesProvider } from './adapters/openai-responses'
import { createOpenAICompatibleProvider } from './adapters/openai-compatible'
import { createAnthropicCompatibleProvider } from './adapters/anthropic-compatible'
import { createOllamaProvider } from './adapters/ollama'
import { discoverModels } from './discovery'
import { testChatProvider } from './testing'

const defaultDependencies: ChatProviderDependencies = {
  fetch,
  createId: () => crypto.randomUUID()
}

function createChatProvider(
  configuration: ChatProviderConfiguration,
  dependencies: ChatProviderDependencies = defaultDependencies
): ChatProvider {
  switch (configuration.provider) {
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

export { createChatProvider, discoverModels, testChatProvider }
export type {
  ChatProvider,
  ChatProviderConfiguration,
  ChatProviderDependencies,
  ChatProviderMessage,
  ChatProviderStreamInput,
  ChatProviderTool,
  ChatProviderToolCall,
  ChatProviderToolCallPart,
  ChatProviderToolResultPart,
  DiscoveredModel,
  DiscoverableProviderId,
  JsonObject,
  JsonValue,
  LocalProviderId,
  ModelDiscoveryDependencies,
  ModelDiscoveryInput,
  ModelReasoningCapabilities,
  ProviderPerformanceMetrics,
  ProviderTestResult,
  ThinkingSelection
} from './contracts'
export type { ProviderTestDependencies } from './testing'
