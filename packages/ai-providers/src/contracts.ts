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
type ProviderFinishReason =
  | 'cancelled'
  | 'content-filter'
  | 'length'
  | 'stop'
  | 'tool-calls'
  | 'unknown'
type ProviderUsage = {
  cachedInputTokens?: number
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
}
type ProviderContinuation =
  | { provider: 'anthropic-compatible'; reasoningSignatures: Record<string, string> }
  | { provider: 'ollama' }
  | { provider: 'openai-compatible' }
  | { provider: 'openai-responses'; responseId: string }
type ProviderFinish = {
  type: 'provider-finish'
  reason: ProviderFinishReason
  continuation?: ProviderContinuation
  usage?: ProviderUsage
}
type ProviderCapabilities = {
  continuation: 'none' | 'response-id' | 'signed-reasoning'
  reasoning: { efforts: ThinkingSelection[]; mode: 'adaptive' | 'budget' | 'effort' | 'none' }
  terminalReason: boolean
  tools: { inputStreaming: boolean; parallelCalls: boolean; strictSchema: boolean }
  usage: { cachedInputTokens: boolean; reasoningTokens: boolean }
}
type ProviderStreamPart = ProviderFinish | UIMessageChunk

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

type ChatProviderAssistantMessage = {
  role: 'assistant'
  parts: Array<ChatProviderTextPart | ChatProviderReasoningPart | ChatProviderToolCallPart>
  providerMetadata?: ProviderMetadata
  replay?: ProviderContinuation
}
type ChatProviderMessage =
  | ChatProviderAssistantMessage
  | {
      role: 'system' | 'user'
      parts: Array<ChatProviderTextPart | ChatProviderReasoningPart>
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
  getCapabilities?: () => Promise<ProviderCapabilities>
  stream: (input: ChatProviderStreamInput) => Promise<AsyncIterable<ProviderStreamPart>>
}

function isProviderFinish(part: ProviderStreamPart): part is ProviderFinish {
  return part.type === 'provider-finish'
}
function providerFinish(input: Omit<ProviderFinish, 'type'>): ProviderFinish {
  return { type: 'provider-finish', ...input }
}

type ChatProviderConfiguration =
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

type LocalProviderId = 'ollama'
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

export { THINKING_SELECTIONS, isProviderFinish, providerFinish }
export type {
  ChatProvider,
  ChatProviderAssistantMessage,
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
  ProviderCapabilities,
  ProviderContinuation,
  ProviderFinish,
  ProviderFinishReason,
  ProviderTestResult,
  ProviderStreamPart,
  ProviderUsage,
  ThinkingSelection
}
