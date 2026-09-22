import { createAnthropicHeaders } from './anthropic-auth'
import type {
  ChatProvider,
  ChatProviderConfiguration,
  ChatProviderDependencies,
  DiscoverableProviderId,
  ModelDiscoveryInput
} from './contracts'
import { createAnthropicCompatibleProvider } from './adapters/anthropic-compatible'
import { createOllamaProvider } from './adapters/ollama'
import { createOpenAICompatibleProvider } from './adapters/openai-compatible'
import { createOpenAIResponsesProvider } from './adapters/openai-responses'
import { getNativeApiUrl, getVersionedApiUrl, getVersionedSiblingApiUrl } from './url'
import * as z from 'zod'

type ModelCandidate = { modelId?: string; displayName?: string }

const ModelStringSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1))
  .optional()
  .catch(undefined)
const OllamaModelsSchema = z
  .object({ models: z.array(z.object({ name: ModelStringSchema })).catch([]) })
  .transform(({ models }) => models.map(({ name }) => ({ modelId: name })))
const OpenAIModelsSchema = z
  .object({
    data: z.array(z.object({ id: ModelStringSchema, display_name: ModelStringSchema })).catch([])
  })
  .transform(({ data }) =>
    data.map(({ id, display_name }) => ({ modelId: id, displayName: display_name }))
  )

function createModelParser(schema: z.ZodType<ModelCandidate[]>) {
  return async (response: Response): Promise<ModelCandidate[]> => {
    const payload: unknown = await response.json()
    const parsed = schema.safeParse(payload)
    return parsed.success ? parsed.data : []
  }
}

function getBearerHeaders(
  apiKey: string | undefined,
  customHeaders: Record<string, string> | undefined
): Headers {
  const headers = new Headers()
  if (apiKey) headers.set('authorization', `Bearer ${apiKey}`)
  for (const [name, value] of Object.entries(customHeaders ?? {})) headers.set(name, value)
  return headers
}

/** The protocol chat endpoint of each provider, appended beneath the configured base URL. */
const chatEndpoints = {
  'openai-responses': 'responses',
  'openai-compatible': 'chat/completions',
  'anthropic-compatible': 'messages',
  ollama: 'api/chat'
} satisfies Record<DiscoverableProviderId, string>

function getChatUrl(provider: DiscoverableProviderId, baseUrl: string): string {
  // Ollama serves its chat protocol on native /api paths and never receives
  // the conventional /v1 fallback the OpenAI-style roots get.
  return provider === 'ollama'
    ? getNativeApiUrl(baseUrl, chatEndpoints[provider])
    : getVersionedApiUrl(baseUrl, chatEndpoints[provider])
}

/**
 * One descriptor per provider: the single home for its protocol endpoints,
 * discovery request shape, and adapter factory. The chat factory and model
 * discovery both consume this table instead of re-encoding provider knowledge.
 */
type ChatProviderDescriptor<C extends ChatProviderConfiguration = ChatProviderConfiguration> = {
  displayName: string
  /** Model-list request for discovery, including the single 401 auth retry when supported. */
  planModelDiscovery: (input: ModelDiscoveryInput) => {
    url: string
    headers: Headers
    retryHeaders: Headers | null
  }
  /** Parses the native model-list payload; malformed entries are skipped by the caller. */
  parseModels: (response: Response) => Promise<ModelCandidate[]>
  createProvider: (configuration: C, dependencies: ChatProviderDependencies) => ChatProvider
}

type ProviderDescriptorTable = {
  'openai-responses': ChatProviderDescriptor<
    Extract<ChatProviderConfiguration, { provider: 'openai-responses' }>
  >
  'openai-compatible': ChatProviderDescriptor<
    Extract<ChatProviderConfiguration, { provider: 'openai-compatible' }>
  >
  'anthropic-compatible': ChatProviderDescriptor<
    Extract<ChatProviderConfiguration, { provider: 'anthropic-compatible' }>
  >
  ollama: ChatProviderDescriptor<Extract<ChatProviderConfiguration, { provider: 'ollama' }>>
}

const providerDescriptors = {
  'openai-responses': {
    displayName: 'OpenAI Responses',
    planModelDiscovery: (input) => ({
      url: getVersionedSiblingApiUrl(input.baseUrl, chatEndpoints['openai-responses'], 'models'),
      headers: getBearerHeaders(input.apiKey, input.headers),
      retryHeaders: null
    }),
    parseModels: createModelParser(OpenAIModelsSchema),
    createProvider: (configuration, dependencies) =>
      createOpenAIResponsesProvider(
        configuration,
        dependencies,
        getChatUrl('openai-responses', configuration.baseUrl)
      )
  },
  'openai-compatible': {
    displayName: 'OpenAI-compatible',
    planModelDiscovery: (input) => ({
      url: getVersionedSiblingApiUrl(input.baseUrl, chatEndpoints['openai-compatible'], 'models'),
      headers: getBearerHeaders(input.apiKey, input.headers),
      retryHeaders: null
    }),
    parseModels: createModelParser(OpenAIModelsSchema),
    createProvider: (configuration, dependencies) =>
      createOpenAICompatibleProvider(
        configuration,
        dependencies,
        getChatUrl('openai-compatible', configuration.baseUrl)
      )
  },
  'anthropic-compatible': {
    displayName: 'Anthropic-compatible',
    planModelDiscovery: (input) => ({
      url: getVersionedSiblingApiUrl(
        input.baseUrl,
        chatEndpoints['anthropic-compatible'],
        'models'
      ),
      headers: createAnthropicHeaders(input.apiKey, input.headers),
      // A gateway that accepts x-api-key can also accept bearer; discovery
      // retries once with bearer authentication after a 401.
      retryHeaders: input.apiKey
        ? createAnthropicHeaders(input.apiKey, input.headers, 'bearer')
        : null
    }),
    parseModels: createModelParser(OpenAIModelsSchema),
    createProvider: (configuration, dependencies) =>
      createAnthropicCompatibleProvider(
        configuration,
        dependencies,
        getChatUrl('anthropic-compatible', configuration.baseUrl)
      )
  },
  ollama: {
    displayName: 'Ollama',
    planModelDiscovery: (input) => ({
      url: getNativeApiUrl(input.baseUrl, 'api/tags'),
      headers: getBearerHeaders(input.apiKey, input.headers),
      retryHeaders: null
    }),
    parseModels: createModelParser(OllamaModelsSchema),
    createProvider: (configuration, dependencies) =>
      createOllamaProvider(configuration, dependencies, getChatUrl('ollama', configuration.baseUrl))
  }
} satisfies ProviderDescriptorTable

export { providerDescriptors }
export type { ChatProviderDescriptor, ModelCandidate }
