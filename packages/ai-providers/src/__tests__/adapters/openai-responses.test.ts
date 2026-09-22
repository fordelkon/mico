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

type ProviderConfiguration = Extract<ChatProviderConfiguration, { provider: 'openai-responses' }>

function providerConfig(overrides: Partial<ProviderConfiguration> = {}): ChatProviderConfiguration {
  return {
    provider: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    modelId: 'gpt-5.2',
    ...overrides
  }
}

function streamInput(
  text = 'Continue.',
  overrides: Partial<ChatProviderStreamInput> = {}
): ChatProviderStreamInput {
  return {
    messages: [{ role: 'user', parts: [{ type: 'text', text }] }],
    thinkingEffort: 'none',
    signal: new AbortController().signal,
    ...overrides
  }
}

function sseResponse(events: string): Response {
  return new Response(events, { headers: { 'content-type': 'text/event-stream' } })
}

describe('OpenAI Responses provider', () => {
  it('user gets a continuation ID when streaming completes, then the finish carries it', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        sseResponse('event: response.completed\ndata: {"response":{"id":"resp_next"}}\n\n')
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetchMock))

    const parts = await collectProtocol(
      await provider.stream(streamInput('Continue.', { thinkingEffort: 'high' }))
    )

    expect(parts).toContainEqual({
      type: 'provider-finish',
      reason: 'stop',
      continuation: { provider: 'openai-responses', responseId: 'resp_next' }
    })
  })

  it('user gets a replayed response continued when its ID is present, then it resumes', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(sseResponse('event: response.completed\ndata: {}\n\n'))
    const provider = createChatProvider(providerConfig(), streamDependencies(fetchMock))

    await collect(
      await provider.stream(
        streamInput('Continue.', {
          thinkingEffort: 'high',
          messages: [
            {
              role: 'assistant',
              parts: [{ type: 'text', text: 'Partial answer.' }],
              replay: { provider: 'openai-responses', responseId: 'resp_previous' }
            },
            { role: 'user', parts: [{ type: 'text', text: 'Continue.' }] }
          ]
        })
      )
    )

    expect(await fetchCallRequestBody(fetchMock)).toMatchObject({
      previous_response_id: 'resp_previous',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'Continue.' }] }]
    })
  })

  it('user sees a resumable finish when tokens run out, then continuation survives', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        sseResponse(
          'event: response.incomplete\ndata: {"response":{"id":"resp_123","status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"usage":{"input_tokens":12,"output_tokens":34,"output_tokens_details":{"reasoning_tokens":21},"total_tokens":46}}}\n\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetchMock))

    const parts = await collectProtocol(
      await provider.stream(streamInput('Continue.', { thinkingEffort: 'high' }))
    )

    expect(parts).toContainEqual({
      type: 'provider-finish',
      reason: 'length',
      continuation: { provider: 'openai-responses', responseId: 'resp_123' },
      usage: { inputTokens: 12, outputTokens: 34, reasoningTokens: 21, totalTokens: 46 }
    })
  })

  it('user gets reasoning and text replayed when sent, then both become input_text', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(sseResponse('event: response.completed\ndata: {}\n\n'))
    const provider = createChatProvider(providerConfig(), streamDependencies(fetchMock))

    await collect(
      await provider.stream(
        streamInput('Continue.', {
          messages: [
            {
              role: 'assistant',
              parts: [
                { type: 'reasoning', text: 'Inspect.' },
                { type: 'text', text: 'Done.' }
              ]
            },
            { role: 'user', parts: [{ type: 'text', text: 'Continue.' }] }
          ]
        })
      )
    )

    expect(await fetchCallRequestBody(fetchMock)).toMatchObject({
      input: [
        {
          role: 'assistant',
          content: [
            { type: 'input_text', text: 'Inspect.' },
            { type: 'input_text', text: 'Done.' }
          ]
        },
        { role: 'user', content: [{ type: 'input_text', text: 'Continue.' }] }
      ]
    })
  })

  it('user sees tool calls assembled by index when several stream, then each completes', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        sseResponse(
          'event: response.output_item.added\ndata: {"output_index":0,"item":{"type":"function_call","call_id":"call_1","name":"read","arguments":""}}\n\nevent: response.function_call_arguments.delta\ndata: {"output_index":0,"delta":"{\\"path\\":\\"a.ts\\"}"}\n\nevent: response.output_item.added\ndata: {"output_index":1,"item":{"type":"function_call","call_id":"call_2","name":"read","arguments":""}}\n\nevent: response.function_call_arguments.delta\ndata: {"output_index":1,"delta":"{\\"path\\":\\"b.ts\\"}"}\n\nevent: response.output_item.done\ndata: {"output_index":0,"item":{"type":"function_call","call_id":"call_1","name":"read","arguments":"{\\"path\\":\\"a.ts\\"}"}}\n\nevent: response.output_item.done\ndata: {"output_index":1,"item":{"type":"function_call","call_id":"call_2","name":"read","arguments":"{\\"path\\":\\"b.ts\\"}"}}\n\nevent: response.completed\ndata: {}\n\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetchMock))

    const chunks = await collect(
      await provider.stream(streamInput('Read files.', { tools: [readTool] }))
    )

    expect(await fetchCallRequestBody(fetchMock)).toMatchObject({
      tools: [{ type: 'function', name: 'read' }]
    })
    expect(chunks).toEqual([
      { type: 'tool-input-start', toolCallId: 'call_1', toolName: 'read' },
      {
        type: 'tool-input-delta',
        toolCallId: 'call_1',
        inputTextDelta: '{"path":"a.ts"}'
      },
      { type: 'tool-input-start', toolCallId: 'call_2', toolName: 'read' },
      {
        type: 'tool-input-delta',
        toolCallId: 'call_2',
        inputTextDelta: '{"path":"b.ts"}'
      },
      {
        type: 'tool-input-available',
        toolCallId: 'call_1',
        toolName: 'read',
        input: { path: 'a.ts' }
      },
      {
        type: 'tool-input-available',
        toolCallId: 'call_2',
        toolName: 'read',
        input: { path: 'b.ts' }
      }
    ])
  })

  it('user gets calls and outputs replayed when history is resent, then IDs survive', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(sseResponse('event: response.completed\ndata: {}\n\n'))
    const provider = createChatProvider(providerConfig(), streamDependencies(fetchMock))

    await collect(
      await provider.stream(
        streamInput('Continue.', {
          messages: [
            {
              role: 'assistant',
              parts: [
                { type: 'text', text: 'I will read it.' },
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
          ]
        })
      )
    )

    expect(await fetchCallRequestBody(fetchMock)).toMatchObject({
      input: [
        {
          role: 'assistant',
          content: [{ type: 'input_text', text: 'I will read it.' }]
        },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'read',
          arguments: '{"path":"a.ts"}'
        },
        { type: 'function_call_output', call_id: 'call_1', output: 'export {}' }
      ]
    })
  })

  it('user sees a tool input error when arguments are malformed, then raw input stays', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        sseResponse(
          'event: response.output_item.added\ndata: {"output_index":0,"item":{"type":"function_call","call_id":"call_1","name":"read","arguments":""}}\n\nevent: response.function_call_arguments.delta\ndata: {"output_index":0,"delta":"{"}\n\nevent: response.output_item.done\ndata: {"output_index":0,"item":{"type":"function_call","call_id":"call_1","name":"read","arguments":"{"}}\n\nevent: response.completed\ndata: {}\n\n'
        )
      )
    const provider = createChatProvider(providerConfig(), streamDependencies(fetchMock))

    await expect(collect(await provider.stream(streamInput('Read.')))).resolves.toContainEqual({
      type: 'tool-input-error',
      toolCallId: 'call_1',
      toolName: 'read',
      input: '{',
      errorText: 'The OpenAI provider returned invalid tool arguments.'
    })
  })

  it('user sees an unknown finish when a response lacks details, then streaming ends', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(sseResponse('event: response.incomplete\ndata: {}\n\n'))
    const provider = createChatProvider(providerConfig(), streamDependencies(fetchMock))

    await expect(
      collectProtocol(await provider.stream(streamInput('Continue.')))
    ).resolves.toContainEqual({ type: 'provider-finish', reason: 'unknown' })
  })

  it('user sees Responses on a versioned root when streaming starts, then it stays', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(sseResponse('event: response.completed\ndata: {}\n\n'))
    const provider = createChatProvider(
      providerConfig({ baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: 'key' }),
      streamDependencies(fetchMock, () => 'part-1')
    )

    await collect(await provider.stream(streamInput('Hi', { thinkingEffort: 'medium' })))

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://ark.cn-beijing.volces.com/api/v3/responses')
  })

  it('user sees reasoning summaries stream beside text when sent, then text follows', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        sseResponse(
          'event: response.reasoning_summary_text.delta\ndata: {"delta":"Inspect the request."}\n\nevent: response.output_text.delta\ndata: {"delta":"Done."}\n\nevent: response.completed\ndata: {}\n\n'
        )
      )
    const provider = createChatProvider(
      providerConfig({ apiKey: 'key' }),
      streamDependencies(fetchMock, () => 'part-1')
    )

    const chunks = await collect(
      await provider.stream(streamInput('Hello', { thinkingEffort: 'high' }))
    )

    expect(await fetchCallRequestBody(fetchMock)).toMatchObject({
      reasoning: { effort: 'high', summary: 'auto' }
    })
    expect(chunks).toEqual([
      { type: 'reasoning-start', id: 'part-1' },
      { type: 'reasoning-delta', id: 'part-1', delta: 'Inspect the request.' },
      { type: 'reasoning-end', id: 'part-1' },
      { type: 'text-start', id: 'part-1' },
      { type: 'text-delta', id: 'part-1', delta: 'Done.' },
      { type: 'text-end', id: 'part-1' }
    ])
  })

  it('user gets a documented request when the model is known, then the contract holds', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        sseResponse(
          'event: response.output_text.delta\ndata: {"delta":"Hello"}\n\nevent: response.completed\ndata: {}\n\n'
        )
      )
    const provider = createChatProvider(
      providerConfig({ apiKey: 'key' }),
      streamDependencies(fetchMock, () => 'part-1')
    )

    const chunks = await collect(
      await provider.stream(streamInput('Hello', { thinkingEffort: 'xhigh' }))
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses',
      expect.objectContaining({ method: 'POST' })
    )
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer key'
    )
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('content-type')).toBe(
      'application/json'
    )
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        model: 'gpt-5.2',
        stream: true,
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
        reasoning: { effort: 'xhigh', summary: 'auto' }
      })
    )
    expect(chunks).toEqual([
      { type: 'text-start', id: 'part-1' },
      { type: 'text-delta', id: 'part-1', delta: 'Hello' },
      { type: 'text-end', id: 'part-1' }
    ])
  })

  it('user gets an optimistic effort when the model is unknown, then it is sent', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(sseResponse('event: response.completed\ndata: {}\n\n'))
    const provider = createChatProvider(
      providerConfig({ baseUrl: 'https://api.openai.com', apiKey: 'key', modelId: 'gpt-5.1' }),
      streamDependencies(fetchMock, () => 'part-1')
    )

    await collect(await provider.stream(streamInput('Hello', { thinkingEffort: 'xhigh' })))

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        model: 'gpt-5.1',
        stream: true,
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
        reasoning: { effort: 'xhigh', summary: 'auto' }
      })
    )
  })

  it('user gets a retry without reasoning when rejected, then the fallback is kept', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 400 }))
      .mockResolvedValue(new Response('event: response.completed\ndata: {}\n\n'))
    const provider = createChatProvider(
      providerConfig({ apiKey: 'key', modelId: 'model' }),
      streamDependencies(fetchMock, () => 'part-1')
    )
    const input = streamInput('Hello', { thinkingEffort: 'high' })

    await collect(await provider.stream(input))
    await collect(await provider.stream(input))

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(await fetchCallRequestBody(fetchMock, 0)).toMatchObject({
      reasoning: { effort: 'high' }
    })
    expect(await fetchCallRequestBody(fetchMock, 1)).not.toHaveProperty('reasoning')
    expect(await fetchCallRequestBody(fetchMock, 2)).not.toHaveProperty('reasoning')
  })
})
