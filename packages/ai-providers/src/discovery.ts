import * as z from 'zod'

import { createAnthropicHeaders } from './anthropic-auth'
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
const LMStudioModelsSchema = z
  .object({
    models: z.array(z.object({ key: ModelStringSchema, display_name: ModelStringSchema })).catch([])
  })
  .transform(({ models }) => models.map(({ key }) => ({ modelId: key })))
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
  const url = new URL(baseUrl)
  const path = url.pathname.replace(/\/+$/, '')
  const root = path.endsWith(`/${requestPath}`) ? path.slice(0, -requestPath.length - 1) : path
  url.pathname = /\/v\d+$/.test(root) ? `${root}/models` : `${root}/v1/models`
  return url.toString()
}

function getAnthropicModelsUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  const path = url.pathname.replace(/\/+$/, '')
  const root = path.endsWith('/messages') ? path.slice(0, -'/messages'.length) : path
  url.pathname = root.endsWith('/v1') ? `${root}/models` : `${root}/v1/models`
  return url.toString()
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
    case 'lm-studio':
      return {
        url: new URL('/api/v1/models', input.baseUrl).toString(),
        headers: getHeaders(input.provider, input.apiKey, input.headers)
      }
    case 'ollama':
      return {
        url: new URL('/api/tags', input.baseUrl).toString(),
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
    provider === 'lm-studio'
      ? LMStudioModelsSchema.safeParse(payload)
      : provider === 'ollama'
        ? OllamaModelsSchema.safeParse(payload)
        : OpenAIModelsSchema.safeParse(payload)
  return normalizeModels(parsed.success ? parsed.data : [])
}

function getProviderName(provider: DiscoverableProviderId): string {
  return provider === 'lm-studio'
    ? 'LM Studio'
    : provider === 'ollama'
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
