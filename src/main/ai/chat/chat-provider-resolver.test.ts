import type { ChatProvider, ChatProviderConfiguration } from '@mico/ai-providers'
import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { createChatProviderResolver } from './chat-provider-resolver'

type ResolvedProvider = Pick<ChatProvider, 'getModelCapabilities' | 'stream'>

function createProvider(): ResolvedProvider {
  return {
    getModelCapabilities: async () => null,
    stream: async () => emptyStream()
  }
}

async function* emptyStream(): AsyncIterable<UIMessageChunk> {}

describe('createChatProviderResolver', () => {
  it('user gets a provider when the model entry is configured, then it clears once removed', () => {
    const firstProvider = createProvider()
    const secondProvider = createProvider()
    let selection: ChatProviderConfiguration | null = {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      modelId: 'qwen3:8b'
    }
    const resolveProvider = createChatProviderResolver({
      getChatConfigurationForModelEntry: () => selection,
      createChatProvider: ({ modelId }) => (modelId === 'qwen3:8b' ? firstProvider : secondProvider)
    })

    expect(resolveProvider('entry-1')).toBe(firstProvider)

    selection = { ...selection, modelId: 'llama3.2' }

    expect(resolveProvider('entry-1')).toBe(secondProvider)

    selection = null

    expect(resolveProvider('entry-1')).toBeNull()
  })
})
