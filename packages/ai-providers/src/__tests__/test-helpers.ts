import {
  isProviderFinish,
  type ChatProviderDependencies,
  type ChatProviderTool,
  type JsonValue,
  type ProviderStreamPart
} from '../index'

export async function collect(stream: AsyncIterable<ProviderStreamPart>) {
  const chunks: ProviderStreamPart[] = []
  for await (const chunk of stream) if (!isProviderFinish(chunk)) chunks.push(chunk)
  return chunks
}

export async function collectProtocol(stream: AsyncIterable<ProviderStreamPart>) {
  const chunks: ProviderStreamPart[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

export function streamDependencies(
  fetch: typeof globalThis.fetch,
  createId: () => string = () => 'part'
): ChatProviderDependencies {
  return { fetch, createId }
}

type FetchMock = { mock: { calls: Array<Parameters<typeof globalThis.fetch>> } }

export async function fetchCallRequestBody(fetch: FetchMock, callIndex = 0): Promise<JsonValue> {
  const body = await new Request('https://example.test', fetch.mock.calls[callIndex]?.[1]).json()
  // SAFETY: request bodies are JSON produced by the provider adapters under test.
  return body as JsonValue
}

export const readTool: ChatProviderTool = {
  name: 'read',
  description: 'Read a file.',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } }
}
