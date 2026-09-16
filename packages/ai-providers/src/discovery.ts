import * as z from 'zod'

import { createAnthropicHeaders } from './anthropic-auth'
import { getNativeApiUrl, getVersionedSiblingApiUrl } from './url'
import type {
  DiscoveredModel,
  DiscoverableProviderId,
  ModelDiscoveryDependencies,
  ModelDiscoveryInput
} from './contracts'

type ModelCandidate = { modelId?: string; displayName?: string }
type ModelDiscoveryRequest = { url: string; headers: Headers }

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

function getOpenAIModelsUrl(
  baseUrl: string,
  requestPath: 'responses' | 'chat/completions'
): string {
  return getVersionedSiblingApiUrl(baseUrl, requestPath, 'models')
}

function getAnthropicModelsUrl(baseUrl: string): string {
  return getVersionedSiblingApiUrl(baseUrl, 'messages', 'models')
}

function getHeaders(
  provider: DiscoverableProviderId,
  apiKey: string | undefined,
  customHeaders: Record<string, string> | undefined
): Headers {
  if (provider === 'anthropic-compatible') return createAnthropicHeaders(apiKey, customHeaders)

  const headers = new Headers()
  if (apiKey) {
    headers.set('authorization', `Bearer ${apiKey}`)
  }
  for (const [name, value] of Object.entries(customHeaders ?? {})) headers.set(name, value)
  return headers
}

function getRequest(input: ModelDiscoveryInput): ModelDiscoveryRequest {
  switch (input.provider) {
    case 'ollama':
      return {
        url: getNativeApiUrl(input.baseUrl, 'api/tags'),
        headers: getHeaders(input.provider, input.apiKey, input.headers)
      }
    case 'openai-responses':
      return {
        url: getOpenAIModelsUrl(input.baseUrl, 'responses'),
        headers: getHeaders(input.provider, input.apiKey, input.headers)
      }
    case 'openai-compatible':
      return {
        url: getOpenAIModelsUrl(input.baseUrl, 'chat/completions'),
        headers: getHeaders(input.provider, input.apiKey, input.headers)
      }
    case 'anthropic-compatible':
      return {
        url: getAnthropicModelsUrl(input.baseUrl),
        headers: getHeaders(input.provider, input.apiKey, input.headers)
      }
  }
}

function normalizeModels(candidates: ModelCandidate[]): DiscoveredModel[] {
  const seen = new Set<string>()
  return candidates.flatMap(({ modelId, displayName }) => {
    if (!modelId || seen.has(modelId)) return []
    seen.add(modelId)
    return [{ modelId, displayName: displayName ?? modelId }]
  })
}

async function parseModels(
  provider: DiscoverableProviderId,
  response: Response
): Promise<DiscoveredModel[]> {
  const payload = await response.json()
  const parsed =
    provider === 'ollama'
      ? OllamaModelsSchema.safeParse(payload)
      : OpenAIModelsSchema.safeParse(payload)
  return normalizeModels(parsed.success ? parsed.data : [])
}

function getProviderName(provider: DiscoverableProviderId): string {
  return provider === 'ollama'
    ? 'Ollama'
    : provider === 'openai-responses'
      ? 'OpenAI Responses'
      : provider === 'openai-compatible'
        ? 'OpenAI-compatible'
        : 'Anthropic-compatible'
}

async function discoverModels(
  input: ModelDiscoveryInput,
  dependencies: ModelDiscoveryDependencies = {}
): Promise<DiscoveredModel[]> {
  const request = getRequest(input)
  const requestFetch = dependencies.fetch ?? fetch
  let response = await requestFetch(request.url, { headers: request.headers })
  if (input.provider === 'anthropic-compatible' && input.apiKey && response.status === 401) {
    response = await requestFetch(request.url, {
      headers: createAnthropicHeaders(input.apiKey, input.headers, 'bearer')
    })
  }
  if (!response.ok)
    throw new Error(
      `${getProviderName(input.provider)} model discovery failed (${response.status} ${response.statusText}).`
    )
  return parseModels(input.provider, response)
}

export { discoverModels }
