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

type JsonValue = boolean | JsonObject | JsonValue[] | null | number | string
type JsonObject = { [key: string]: JsonValue }

type ModelReasoningCapabilities = {
  availability?: 'supported' | 'unknown'
  selectableEfforts: ThinkingSelection[]
  defaultEffort: ThinkingSelection
}

type ChatProviderTextPart = { type: 'text'; text: string }
type ChatProviderToolCall = {
  toolCallId: string
  toolName: string
  argumentsJson: string
}
type ChatProviderToolCallPart = ChatProviderToolCall & { type: 'tool-call' }
type ChatProviderToolResultPart = {
  type: 'tool-result'
  toolCallId: string
  toolName: string
  output: string
  isError: boolean
}
type ChatProviderReasoningPart = {
  type: 'reasoning'
  text: string
  providerMetadata?: ProviderMetadata
}

type ChatProviderMessage =
  | {
      role: 'system' | 'user' | 'assistant'
      parts: Array<ChatProviderTextPart | ChatProviderReasoningPart | ChatProviderToolCallPart>
      providerMetadata?: ProviderMetadata
    }
  | { role: 'tool'; parts: ChatProviderToolResultPart[]; providerMetadata?: ProviderMetadata }
type ChatProviderTool = { name: string; description: string; inputSchema: JsonObject }

type ChatProviderStreamInput = {
  collectPerformanceMetrics?: boolean
  conversationKey: string
  messages: ChatProviderMessage[]
  tools?: readonly ChatProviderTool[]
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
  ChatProviderTool,
  ChatProviderToolCall,
  ChatProviderToolCallPart,
  ChatProviderToolResultPart,
  ChatProviderStreamInput,
  DiscoveredModel,
  DiscoverableProviderId,
  LocalProviderId,
  JsonObject,
  JsonValue,
  ModelDiscoveryDependencies,
  ModelDiscoveryInput,
  ModelReasoningCapabilities,
  ProviderPerformanceMetrics,
  ProviderTestResult,
  ThinkingSelection
}
