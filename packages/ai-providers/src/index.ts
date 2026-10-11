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
import { ProviderError, throwNormalizedTransportError, safeProviderFetch } from './provider-error'
export { ProviderError } from './provider-error'
export type { ProviderErrorKind, ProviderErrorOptions } from './provider-error'
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
  return withProviderFinish(
    descriptor.createProvider(configuration, {
      ...dependencies,
      fetch: safeProviderFetch(dependencies.fetch)
    })
  )
}

function withProviderFinish(provider: ChatProvider): ChatProvider {
  return {
    ...provider,
    async stream(input) {
      const stream = await provider.stream(input)
      return (async function* () {
        let receivedFinish = false
        try {
          for await (const part of stream) {
            if (isProviderFinish(part)) receivedFinish = true
            yield part
          }
        } catch (error) {
          throwNormalizedTransportError(error)
        }
        if (!receivedFinish) throw new ProviderError('incomplete_stream')
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
