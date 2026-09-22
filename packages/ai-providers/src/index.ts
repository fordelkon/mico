import {
  isProviderFinish,
  providerFinish,
  type ChatProvider,
  type ChatProviderConfiguration,
  type ChatProviderDependencies
} from './contracts'
import { providerDescriptors, type ChatProviderDescriptor } from './provider-registry'
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
  // SAFETY: the descriptor table is keyed by the same discriminator as the
  // configuration union, so the entry matches configuration's provider; the
  // wide descriptor type is the correlated-union access TS cannot infer.
  const descriptor = providerDescriptors[configuration.provider] as ChatProviderDescriptor
  return withProviderFinish(descriptor.createProvider(configuration, dependencies))
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
