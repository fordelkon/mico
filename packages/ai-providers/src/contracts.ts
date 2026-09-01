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
  conversationKey: string
  messages: ChatProviderMessage[]
  thinkingEffort: ThinkingSelection
  signal: AbortSignal
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
    }
  | {
      provider: 'openai-responses'
      baseUrl: string
      modelId: string
      apiKey: string
    }
  | {
      provider: 'openai-compatible'
      baseUrl: string
      modelId: string
      apiKey?: string
    }
  | {
      provider: 'anthropic-compatible'
      baseUrl: string
      modelId: string
      apiKey: string
      maxTokens?: number
    }
  | {
      provider: 'ollama'
      baseUrl: string
      modelId: string
    }

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
  ModelReasoningCapabilities,
  ThinkingSelection
}
