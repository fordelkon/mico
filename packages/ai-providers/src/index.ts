import {
  isProviderFinish,
  providerFinish,
  type ChatProvider,
  type ChatProviderConfiguration,
  type ChatProviderDependencies
} from './contracts'
import { createOpenAIResponsesProvider } from './adapters/openai-responses'
import { createOpenAICompatibleProvider } from './adapters/openai-compatible'
import { createAnthropicCompatibleProvider } from './adapters/anthropic-compatible'
import { createOllamaProvider } from './adapters/ollama'
import { discoverModels } from './discovery'
import { testChatProvider } from './testing'
export { resolveThinkingSelection } from './reasoning'

const defaultDependencies: ChatProviderDependencies = {
  fetch,
  createId: () => crypto.randomUUID()
}

function createChatProvider(
  configuration: ChatProviderConfiguration,
  dependencies: ChatProviderDependencies = defaultDependencies
): ChatProvider {
  let provider: ChatProvider
  switch (configuration.provider) {
    case 'openai-responses':
      provider = createOpenAIResponsesProvider(configuration, dependencies)
      break
    case 'openai-compatible':
      provider = createOpenAICompatibleProvider(configuration, dependencies)
      break
    case 'anthropic-compatible':
      provider = createAnthropicCompatibleProvider(configuration, dependencies)
      break
    case 'ollama':
      provider = createOllamaProvider(configuration, dependencies)
      break
  }
  return withProviderFinish(provider)
}

function withProviderFinish(provider: ChatProvider): ChatProvider {
  return {
    ...provider,
    async stream(input) {
      const stream = await provider.stream(input)
      return (async function* () {
        let receivedFinish = false
        for await (const part of stream) {
          if (isProviderFinish(part)) receivedFinish = true
          yield part
        }
        // Adapters own native failure mapping; this wrapper only supplies the
        // successful-stop default for protocols without a richer terminal event.
        if (!receivedFinish) yield providerFinish({ reason: 'stop' })
      })()
    }
  }
}

export { isProviderFinish, providerFinish }

export { createChatProvider, discoverModels, testChatProvider }
export type {
  ChatProvider,
  ChatProviderAssistantMessage,
  ChatProviderConfiguration,
  ChatProviderDependencies,
  ChatProviderMessage,
  ChatProviderReasoningPart,
  ChatProviderTextPart,
  ChatProviderStreamInput,
  ChatProviderTool,
  ChatProviderToolCall,
  ChatProviderToolCallPart,
  ChatProviderToolResultPart,
  DiscoveredModel,
  DiscoverableProviderId,
  JsonObject,
  JsonValue,
  ModelDiscoveryDependencies,
  ModelDiscoveryInput,
  ModelReasoningCapabilities,
  ProviderPerformanceMetrics,
  ProviderContinuation,
  ProviderFinish,
  ProviderFinishReason,
  ProviderTestResult,
  ProviderStreamPart,
  ProviderUsage,
  ThinkingSelection
} from './contracts'
export type { ProviderTestDependencies } from './testing'
