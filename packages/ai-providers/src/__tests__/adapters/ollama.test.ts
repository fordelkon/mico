import { describe, expect, it, vi } from 'vitest'
import { createChatProvider, isProviderFinish, type ProviderStreamPart } from '../../index'
async function collect(stream: AsyncIterable<ProviderStreamPart>) {
  const chunks = []
  for await (const chunk of stream) if (!isProviderFinish(chunk)) chunks.push(chunk)
  return chunks
}
async function collectProtocol(stream: AsyncIterable<ProviderStreamPart>) {
  const chunks: ProviderStreamPart[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}
describe('Ollama provider', () => {
  it('maps a native length terminal reason into the provider protocol envelope', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('{"done":true,"done_reason":"length"}\n'))
    const provider = createChatProvider(
      { provider: 'ollama', baseUrl: 'http://localhost:11434', modelId: 'llama3.2' },
      { fetch, createId: () => 'part' }
    )

    const parts = await collectProtocol(
      await provider.stream({
        conversationKey: 'x',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
        thinkingEffort: 'none',
        signal: new AbortController().signal
      })
    )

    expect(parts).toContainEqual({ type: 'provider-finish', reason: 'length' })
  })

  it('reports no reasoning capabilities for a model without the native thinking capability', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ capabilities: ['completion', 'tools'] })))
    const provider = createChatProvider(
      { provider: 'ollama', baseUrl: 'http://localhost:11434', modelId: 'llama3.2' },
      { fetch, createId: () => 'part' }
    )

    await expect(provider.getModelCapabilities()).resolves.toBeNull()

    expect(fetch.mock.calls[0]?.[0]).toBe('http://localhost:11434/api/show')
    expect(await new Request('https://example.test', fetch.mock.calls[0]?.[1]).json()).toEqual({
      model: 'llama3.2'
    })
  })

  it('retains optimistic effort choices for a model with the native thinking capability', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ capabilities: ['completion', 'thinking'] })))
    const provider = createChatProvider(
      { provider: 'ollama', baseUrl: 'http://localhost:11434', modelId: 'qwen3' },
      { fetch, createId: () => 'part' }
    )

    await expect(provider.getModelCapabilities()).resolves.toEqual({
      availability: 'unknown',
      selectableEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'medium'
    })
  })

  it('preserves a gateway path prefix when appending the native chat endpoint', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('{"done":true}\n'))
    const provider = createChatProvider(
      {
        provider: 'ollama',
        baseUrl: 'https://gateway.example.com/ollama',
        modelId: 'qwen3'
      },
      { fetch, createId: () => 'part' }
    )

    await collect(
      await provider.stream({
        conversationKey: 'x',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello.' }] }],
        thinkingEffort: 'none',
        signal: new AbortController().signal
      })
    )

    expect(fetch.mock.calls[0]?.[0]).toBe('https://gateway.example.com/ollama/api/chat')
  })

  it('maps tools, completed calls, and result replay to the native chat protocol', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          '{"message":{"tool_calls":[{"id":"call_1","function":{"name":"read","arguments":{"path":"a.ts"}}}]},"done":true}\n'
        )
      )
    const provider = createChatProvider(
      { provider: 'ollama', baseUrl: 'http://localhost:11434', modelId: 'qwen3' },
      { fetch, createId: () => 'generated-call' }
    )

    const chunks = await collect(
      await provider.stream({
        conversationKey: 'x',
        messages: [
          {
            role: 'assistant',
            parts: [
              {
                type: 'tool-call',
                toolCallId: 'call_1',
                toolName: 'read',
                argumentsJson: '{"path":"a.ts"}'
              }
            ]
          },
          {
            role: 'tool',
            parts: [
              {
                type: 'tool-result',
                toolCallId: 'call_1',
                toolName: 'read',
                output: 'export {}',
                isError: false
              }
            ]
          }
        ],
        tools: [
          {
            name: 'read',
            description: 'Read a file.',
            inputSchema: { type: 'object', properties: { path: { type: 'string' } } }
          }
        ],
        thinkingEffort: 'none',
        signal: new AbortController().signal
      })
    )

    expect(
      await new Request('https://example.test', fetch.mock.calls[0]?.[1]).json()
    ).toMatchObject({
      tools: [{ type: 'function', function: { name: 'read' } }],
      messages: [
        {
          role: 'assistant',
          tool_calls: [{ function: { name: 'read', arguments: { path: 'a.ts' } } }]
        },
        { role: 'tool', tool_name: 'read', content: 'export {}' }
      ]
    })
    expect(chunks).toEqual([
      { type: 'tool-input-start', toolCallId: 'call_1', toolName: 'read' },
      {
        type: 'tool-input-available',
        toolCallId: 'call_1',
        toolName: 'read',
        input: { path: 'a.ts' }
      }
    ])
  })

  it('marks a non-object native argument payload as a tool input error', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          '{"message":{"tool_calls":[{"function":{"name":"read","arguments":"{"}}]},"done":true}\n'
        )
      )
    const provider = createChatProvider(
      { provider: 'ollama', baseUrl: 'http://localhost:11434', modelId: 'qwen3' },
      { fetch, createId: () => 'generated-call' }
    )

    await expect(
      collect(
        await provider.stream({
          conversationKey: 'x',
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'Read.' }] }],
          thinkingEffort: 'none',
          signal: new AbortController().signal
        })
      )
    ).resolves.toEqual([
      { type: 'tool-input-start', toolCallId: 'generated-call', toolName: 'read' },
      {
        type: 'tool-input-error',
        toolCallId: 'generated-call',
        toolName: 'read',
        input: '{',
        errorText: 'The Ollama provider returned invalid tool arguments.'
      }
    ])
  })

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
