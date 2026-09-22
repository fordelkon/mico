import { describe, expect, it, vi } from 'vitest'

import {
  createChatProvider,
  type ChatProviderConfiguration,
  type ChatProviderStreamInput
} from '../../index'
import {
  collect,
  collectProtocol,
  fetchCallRequestBody,
  readTool,
  streamDependencies
} from '../test-helpers'

type ProviderConfiguration = Extract<ChatProviderConfiguration, { provider: 'ollama' }>

function providerConfig(overrides: Partial<ProviderConfiguration> = {}): ChatProviderConfiguration {
  return {
    provider: 'ollama',
    baseUrl: 'http://localhost:11434',
    modelId: 'qwen3',
    ...overrides
  }
}

function streamInput(
  text = 'Hi',
  overrides: Partial<ChatProviderStreamInput> = {}
): ChatProviderStreamInput {
  return {
    messages: [{ role: 'user', parts: [{ type: 'text', text }] }],
    thinkingEffort: 'none',
    signal: new AbortController().signal,
    ...overrides
  }
}

describe('Ollama provider', () => {
  it('user sees a length finish when Ollama reports a done reason, then it is mapped', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('{"done":true,"done_reason":"length"}\n'))
    const provider = createChatProvider(
      providerConfig({ modelId: 'llama3.2' }),
      streamDependencies(fetch)
    )

    const parts = await collectProtocol(await provider.stream(streamInput('Hello')))

    expect(parts).toContainEqual({ type: 'provider-finish', reason: 'length' })
  })

  it('user gets no thinking capabilities when models lack them, then the query is null', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ capabilities: ['completion', 'tools'] })))
    const provider = createChatProvider(
      providerConfig({ modelId: 'llama3.2' }),
      streamDependencies(fetch)
    )

    await expect(provider.getModelCapabilities()).resolves.toBeNull()

    expect(fetch.mock.calls[0]?.[0]).toBe('http://localhost:11434/api/show')
    expect(await fetchCallRequestBody(fetch)).toEqual({ model: 'llama3.2' })
  })

  it('user sees all efforts offered when a model has native thinking, then none pruned', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ capabilities: ['completion', 'thinking'] })))
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await expect(provider.getModelCapabilities()).resolves.toEqual({
      availability: 'unknown',
      selectableEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'medium'
    })
  })

  it('user keeps a gateway prefix when the endpoint is added, then requests go under', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('{"done":true}\n'))
    const provider = createChatProvider(
      providerConfig({ baseUrl: 'https://gateway.example.com/ollama' }),
      streamDependencies(fetch)
    )

    await collect(await provider.stream(streamInput('Hello.')))

    expect(fetch.mock.calls[0]?.[0]).toBe('https://gateway.example.com/ollama/api/chat')
  })

  it('user gets tool history mapped natively when it is resent, then new calls stream', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          '{"message":{"tool_calls":[{"id":"call_1","function":{"name":"read","arguments":{"path":"a.ts"}}}]},"done":true}\n'
        )
      )
    const provider = createChatProvider(
      providerConfig(),
      streamDependencies(fetch, () => 'generated-call')
    )

    const chunks = await collect(
      await provider.stream(
        streamInput('Hi', {
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
          tools: [readTool]
        })
      )
    )

    expect(await fetchCallRequestBody(fetch)).toMatchObject({
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

  it('user sees a tool input error when arguments are not objects, then input is kept', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          '{"message":{"tool_calls":[{"function":{"name":"read","arguments":"{"}}]},"done":true}\n'
        )
      )
    const provider = createChatProvider(
      providerConfig(),
      streamDependencies(fetch, () => 'generated-call')
    )

    await expect(collect(await provider.stream(streamInput('Read.')))).resolves.toEqual([
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

  it('user sees thinking and text normalized when NDJSON has both, then each streams', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          '{"message":{"thinking":"Inspect."},"done":false}\n{"message":{"content":"Done."},"done":true}\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await expect(
      collect(await provider.stream(streamInput('Hi', { thinkingEffort: 'auto' })))
    ).resolves.toEqual([
      { type: 'reasoning-start', id: 'part' },
      { type: 'reasoning-delta', id: 'part', delta: 'Inspect.' },
      { type: 'reasoning-end', id: 'part' },
      { type: 'text-start', id: 'part' },
      { type: 'text-delta', id: 'part', delta: 'Done.' },
      { type: 'text-end', id: 'part' }
    ])
  })

  it('user gets thinking enabled when effort is automatic, then think true is sent', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('{"done":true}\n'))
    const provider = createChatProvider(providerConfig(), streamDependencies(fetch))

    await collect(await provider.stream(streamInput('Hi', { thinkingEffort: 'auto' })))

    expect(await fetchCallRequestBody(fetch)).toMatchObject({ think: true })
  })
})
