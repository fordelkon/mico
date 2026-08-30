import { describe, expect, it, vi } from 'vitest'

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { convertToModelMessages } from 'ai'
import type { ChatConfiguration } from '../config'
import type { ChatMessage } from '@shared/data/schemas/chat'
import {
  createOpenAICompatibleChatStream,
  type OpenAICompatibleDependencies
} from './openai-compatible-provider'

describe('createOpenAICompatibleChatStream', () => {
  it('converts messages and returns the AI SDK UI stream with the supplied abort signal', async () => {
    const configuration: ChatConfiguration = {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'key',
      modelId: 'model-id'
    }
    const messages: ChatMessage[] = [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }]
    const abortSignal = new AbortController().signal
    const convertedMessages = await convertToModelMessages(messages)
    const actualProvider = createOpenAICompatible({
      name: 'test',
      baseURL: configuration.baseUrl,
      apiKey: configuration.apiKey
    })
    const model = actualProvider(configuration.modelId)
    const provider = vi.fn(() => model)
    const createOpenAICompatibleSpy = vi.fn(() => provider)
    const convertToModelMessagesSpy = vi.fn().mockResolvedValue(convertedMessages)
    const providerStream = new ReadableStream<never>()
    const streamTextSpy = vi.fn(() => ({ stream: providerStream }))
    const toUIMessageStreamSpy = vi.fn(async function* () {})

    const dependencies = {
      createOpenAICompatible: createOpenAICompatibleSpy,
      convertToModelMessages: convertToModelMessagesSpy,
      streamText: streamTextSpy,
      toUIMessageStream: toUIMessageStreamSpy
    } satisfies OpenAICompatibleDependencies
    const stream = await createOpenAICompatibleChatStream(configuration, dependencies)(
      messages,
      abortSignal
    )

    expect(createOpenAICompatibleSpy).toHaveBeenCalledWith({
      name: 'mico',
      baseURL: configuration.baseUrl,
      apiKey: configuration.apiKey
    })
    expect(provider).toHaveBeenCalledWith(configuration.modelId)
    expect(streamTextSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        model,
        abortSignal,
        messages: convertedMessages
      })
    )
    expect(toUIMessageStreamSpy).toHaveBeenCalledWith({
      stream: providerStream
    })
    expect(stream).toBe(toUIMessageStreamSpy.mock.results[0]?.value)
  })
})
