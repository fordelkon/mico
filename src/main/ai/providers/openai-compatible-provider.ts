import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { convertToModelMessages, streamText, toUIMessageStream, type UIMessageChunk } from 'ai'

import type { ChatMessage } from '@shared/data/schemas/chat'
import type { ChatStreamFactory } from '../chat-service'
import type { ChatConfiguration } from '../config'

type ChatModel = ReturnType<ReturnType<typeof createOpenAICompatible>>
type ModelMessages = Awaited<ReturnType<typeof convertToModelMessages>>
type ProviderStream = ReturnType<typeof streamText>['stream']

type OpenAICompatibleDependencies = {
  createOpenAICompatible: (
    settings: Parameters<typeof createOpenAICompatible>[0]
  ) => (modelId: string) => ChatModel
  convertToModelMessages: (messages: ChatMessage[]) => Promise<ModelMessages>
  streamText: (input: { model: ChatModel; messages: ModelMessages; abortSignal: AbortSignal }) => {
    stream: ProviderStream
  }
  toUIMessageStream: (input: { stream: ProviderStream }) => AsyncIterable<UIMessageChunk>
}

const defaultDependencies: OpenAICompatibleDependencies = {
  createOpenAICompatible,
  convertToModelMessages,
  streamText: ({ model, messages, abortSignal }) => ({
    stream: streamText({ model, messages, abortSignal }).stream
  }),
  toUIMessageStream: ({ stream }) => toUIMessageStream({ stream })
}

function createOpenAICompatibleChatStream(
  configuration: ChatConfiguration,
  dependencies: OpenAICompatibleDependencies = defaultDependencies
): ChatStreamFactory {
  const provider = dependencies.createOpenAICompatible({
    name: 'mico',
    baseURL: configuration.baseUrl,
    apiKey: configuration.apiKey
  })
  const model = provider(configuration.modelId)

  return async (messages, abortSignal) => {
    const modelMessages = await dependencies.convertToModelMessages(messages)
    const result = dependencies.streamText({ model, messages: modelMessages, abortSignal })

    return dependencies.toUIMessageStream({ stream: result.stream })
  }
}

export { createOpenAICompatibleChatStream }
export type { OpenAICompatibleDependencies }
