import { describe, expect, it, vi } from 'vitest'
import { createChatProvider } from '../index'
async function collect(stream: AsyncIterable<unknown>) {
  const chunks: unknown[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}
describe('Ollama provider', () => {
  it('normalizes NDJSON thinking and answer fields', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          '{"message":{"thinking":"Inspect."},"done":false}\n{"message":{"content":"Done."},"done":true}\n'
        )
      )
    const provider = createChatProvider(
      { provider: 'ollama', baseUrl: 'http://localhost:11434', modelId: 'qwen3' },
      { fetch, createId: () => 'part' }
    )
    await expect(
      collect(
        await provider.stream({
          conversationKey: 'x',
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
          thinkingEffort: 'auto',
          signal: new AbortController().signal
        })
      )
    ).resolves.toEqual([
      { type: 'reasoning-start', id: 'part' },
      { type: 'reasoning-delta', id: 'part', delta: 'Inspect.' },
      { type: 'reasoning-end', id: 'part' },
      { type: 'text-start', id: 'part' },
      { type: 'text-delta', id: 'part', delta: 'Done.' },
      { type: 'text-end', id: 'part' }
    ])
  })

  it('enables thinking for the shared automatic selection', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('{"done":true}\n'))
    const provider = createChatProvider(
      { provider: 'ollama', baseUrl: 'http://localhost:11434', modelId: 'qwen3' },
      { fetch, createId: () => 'part' }
    )

    await collect(
      await provider.stream({
        conversationKey: 'x',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
        thinkingEffort: 'auto',
        signal: new AbortController().signal
      })
    )

    const body = await new Request('https://example.test', fetch.mock.calls[0]?.[1]).text()
    expect(JSON.parse(body)).toMatchObject({ think: true })
  })
})
