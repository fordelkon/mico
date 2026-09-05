import type { ProviderMetadata, UIMessageChunk } from 'ai'

const THINKING_SELECTIONS = [
  'default',
  'none',
  'auto',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const

type ThinkingSelection = (typeof THINKING_SELECTIONS)[number]

type ModelReasoningCapabilities = {
  availability?: 'supported' | 'unknown'
  selectableEfforts: ThinkingSelection[]
  defaultEffort: ThinkingSelection
}

type ChatProviderTextPart = { type: 'text'; text: string }
type ChatProviderReasoningPart = {
  type: 'reasoning'
  text: string
  providerMetadata?: ProviderMetadata
}

type ChatProviderMessage = {
  role: 'system' | 'user' | 'assistant'
  parts: Array<ChatProviderTextPart | ChatProviderReasoningPart>
  providerMetadata?: ProviderMetadata
}

type ChatProviderStreamInput = {
  collectPerformanceMetrics?: boolean
  conversationKey: string
  messages: ChatProviderMessage[]
  thinkingEffort: ThinkingSelection
  signal: AbortSignal
  onPerformanceMetrics?: (metrics: ProviderPerformanceMetrics) => void
}

type ProviderPerformanceMetrics = {
  outputTokens?: number
  timeToFirstTokenMs?: number
  tokensPerSecond?: number
}

type ProviderTestResult = ProviderPerformanceMetrics & {
  durationMs: number
}

type ChatProvider = {
  getModelCapabilities: () => Promise<ModelReasoningCapabilities | null>
  stream: (input: ChatProviderStreamInput) => Promise<AsyncIterable<UIMessageChunk>>
}

type ChatProviderConfiguration =
  | {
      provider: 'lm-studio'
      baseUrl: string
      modelId: string
      apiKey?: string
      headers?: Record<string, string>
    }
  | {
      provider: 'openai-responses'
      baseUrl: string
      modelId: string
      apiKey?: string
      headers?: Record<string, string>
    }
  | {
      provider: 'openai-compatible'
      baseUrl: string
      modelId: string
      apiKey?: string
      headers?: Record<string, string>
      useMaxCompletionTokens?: boolean
    }
  | {
      provider: 'anthropic-compatible'
      baseUrl: string
      modelId: string
      apiKey?: string
      headers?: Record<string, string>
      maxTokens?: number
    }
  | {
      provider: 'ollama'
      baseUrl: string
      modelId: string
      headers?: Record<string, string>
    }

type LocalProviderId = 'lm-studio' | 'ollama'
type DiscoverableProviderId = ChatProviderConfiguration['provider']
type DiscoveredModel = { modelId: string; displayName: string }
type ModelDiscoveryInput = {
  provider: DiscoverableProviderId
  baseUrl: string
  apiKey?: string
  headers?: Record<string, string>
}
type ModelDiscoveryDependencies = { fetch?: typeof fetch }

type ChatProviderDependencies = {
  fetch: typeof fetch
  createId: () => string
}

export { THINKING_SELECTIONS }
export type {
  ChatProvider,
  ChatProviderConfiguration,
  ChatProviderDependencies,
  ChatProviderMessage,
  ChatProviderReasoningPart,
  ChatProviderTextPart,
  ChatProviderStreamInput,
  DiscoveredModel,
  DiscoverableProviderId,
  LocalProviderId,
  ModelDiscoveryDependencies,
  ModelDiscoveryInput,
  ModelReasoningCapabilities,
  ProviderPerformanceMetrics,
  ProviderTestResult,
  ThinkingSelection
}
