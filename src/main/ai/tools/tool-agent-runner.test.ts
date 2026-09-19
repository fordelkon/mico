import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  providerFinish,
  type ChatProvider,
  type ChatProviderStreamInput,
  type ProviderStreamPart
} from '@mico/ai-providers'
import type { UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ToolAgentRunner } from './tool-agent-runner'
import { ToolRegistry, type ToolCall } from './tool-registry'

async function* streamFrom(chunks: ProviderStreamPart[]): AsyncIterable<ProviderStreamPart> {
  yield* chunks
}

describe('ToolAgentRunner', () => {
  const temporaryPaths: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryPaths.splice(0).map((path) => rm(path, { force: true, recursive: true }))
    )
  })

  it('returns visible reasoning and a terminal continuation without creating a tool round', async () => {
    const onStep = vi.fn()
    // SAFETY: this fixture conforms to the documented reasoning-delta UI chunk.
    const reasoningDelta = {
      type: 'reasoning-delta',
      id: 'reasoning-1',
      delta: 'Visible thought.'
    } as UIMessageChunk
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      stream: async () =>
        streamFrom([
          // SAFETY: this fixture conforms to the documented reasoning-start UI chunk.
          { type: 'reasoning-start', id: 'reasoning-1' } as UIMessageChunk,
          reasoningDelta,
          // SAFETY: this fixture conforms to the documented reasoning-end UI chunk.
          { type: 'reasoning-end', id: 'reasoning-1' } as UIMessageChunk,
          { type: 'text-delta', id: 'answer', delta: 'Done.' },
          providerFinish({
            reason: 'stop',
            continuation: { provider: 'openai-responses', responseId: 'resp-1' }
          })
        ])
    }

    // SAFETY: the test adds the proposed callback to an otherwise valid runner input.
    const input = {
      conversationKey: 'test-session',
      provider,
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Answer.' }] }],
      thinkingEffort: 'none',
      signal: new AbortController().signal,
      emit: () => undefined,
      onStep
    } as Parameters<ToolAgentRunner['run']>[0] & { onStep: typeof onStep }
    const result = await new ToolAgentRunner().run(input)

    expect(result).toMatchObject({
      assistantText: 'Done.',
      finalAssistant: {
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'Visible thought.' },
          { type: 'text', text: 'Done.' }
        ],
        replay: { provider: 'openai-responses', responseId: 'resp-1' }
      }
    })
    expect(onStep).not.toHaveBeenCalled()
  })

  it('replays a completed call and result before the next provider request', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'mico-tool-runner-'))
    temporaryPaths.push(cwd)
    await writeFile(join(cwd, 'a.txt'), 'contents')
    const calls: ChatProviderStreamInput[] = []
    const emitted: UIMessageChunk[] = []
    const steps: unknown[] = []
    const stream = vi.fn(async (input: ChatProviderStreamInput) => {
      calls.push(input)
      return calls.length === 1
        ? streamFrom([
            // SAFETY: this fixture conforms to the documented incremental dynamic-tool chunk.
            {
              type: 'tool-input-start',
              toolCallId: 'call-1',
              toolName: 'read'
            } as UIMessageChunk,
            // SAFETY: this fixture continues the preceding documented dynamic-tool input stream.
            {
              type: 'tool-input-delta',
              toolCallId: 'call-1',
              inputTextDelta: '{"path":"a.txt"}'
            } as UIMessageChunk,
            // SAFETY: this fixture completes the preceding documented dynamic-tool input stream.
            {
              type: 'tool-input-available',
              toolCallId: 'call-1',
              toolName: 'read',
              input: { path: 'a.txt' }
            } as UIMessageChunk
          ])
        : streamFrom([{ type: 'text-delta', id: 'answer', delta: 'done' }])
    })
    const provider: ChatProvider = { getModelCapabilities: async () => null, stream }

    const result = await new ToolAgentRunner().run({
      conversationKey: 'test-session',
      provider,
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Read a.txt' }] }],
      registry: ToolRegistry.forWorkspace(cwd),
      thinkingEffort: 'none',
      signal: new AbortController().signal,
      emit: (chunk) => emitted.push(chunk),
      onStep: (step) => steps.push(step)
    })

    expect(result.assistantText).toBe('done')
    expect(emitted).toEqual([
      {
        type: 'tool-input-start',
        toolCallId: 'call-1',
        toolName: 'read',
        dynamic: true
      },
      {
        type: 'tool-input-delta',
        toolCallId: 'call-1',
        inputTextDelta: '{"path":"a.txt"}'
      },
      {
        type: 'tool-input-available',
        toolCallId: 'call-1',
        toolName: 'read',
        input: { path: 'a.txt' },
        dynamic: true
      },
      {
        type: 'tool-output-available',
        toolCallId: 'call-1',
        output: 'contents',
        dynamic: true
      },
      { type: 'text-delta', id: 'answer', delta: 'done' }
    ])
    expect(calls).toHaveLength(2)
    expect(steps).toEqual([
      expect.objectContaining({
        index: 1,
        assistant: expect.objectContaining({ role: 'assistant' }),
        toolResults: [expect.objectContaining({ toolCallId: 'call-1', output: 'contents' })]
      })
    ])
    expect(calls[1].messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Read a.txt' }] },
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'read',
            argumentsJson: '{"path":"a.txt"}'
          }
        ]
      },
      {
        role: 'tool',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'read',
            output: 'contents',
            isError: false
          }
        ]
      }
    ])
  })

  it('reserves the next model step for a final answer when a tool batch exceeds the call budget', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'mico-tool-runner-'))
    temporaryPaths.push(cwd)
    const requests: ChatProviderStreamInput[] = []
    const emitted: UIMessageChunk[] = []
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      stream: async (input) => {
        requests.push(input)
        return requests.length === 1
          ? streamFrom(
              // SAFETY: every generated fixture is a complete documented tool-input-available UI chunk.
              Array.from({ length: 65 }, (_, index) => ({
                type: 'tool-input-available',
                toolCallId: `call-${index}`,
                toolName: 'read',
                input: { path: `file-${index}.txt` }
              })) as UIMessageChunk[]
            )
          : streamFrom([{ type: 'text-delta', id: 'answer', delta: 'Best effort answer.' }])
      }
    }

    const result = await new ToolAgentRunner().run({
      conversationKey: 'test-session',
      provider,
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Inspect every file.' }] }],
      registry: ToolRegistry.forWorkspace(cwd),
      thinkingEffort: 'none',
      signal: new AbortController().signal,
      emit: (chunk) => emitted.push(chunk)
    })

    expect(result.assistantText).toBe('Best effort answer.')
    expect(requests).toHaveLength(2)
    expect(requests[1]?.tools).toBeUndefined()
    expect(emitted.filter((chunk) => chunk.type === 'tool-output-error')).toHaveLength(65)
  })

  it('bounds tool output before adding it to the next provider request', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'mico-tool-runner-'))
    temporaryPaths.push(cwd)
    await writeFile(join(cwd, 'large.txt'), 'x'.repeat(70 * 1024))
    const requests: ChatProviderStreamInput[] = []
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      stream: async (input) => {
        requests.push(input)
        return requests.length === 1
          ? streamFrom([
              // SAFETY: this fixture matches the provider's documented completed tool-call chunk.
              {
                type: 'tool-input-available',
                toolCallId: 'call-large',
                toolName: 'read',
                input: { path: 'large.txt', limit: 2_000 }
              } as UIMessageChunk
            ])
          : streamFrom([{ type: 'text-delta', id: 'answer', delta: 'done' }])
      }
    }

    await new ToolAgentRunner().run({
      conversationKey: 'test-session',
      provider,
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Read the file.' }] }],
      registry: ToolRegistry.forWorkspace(cwd),
      thinkingEffort: 'none',
      signal: new AbortController().signal,
      emit: () => undefined
    })

    const toolResult = requests[1]?.messages.at(-1)
    expect(toolResult).toMatchObject({ role: 'tool' })
    const output = toolResult?.role === 'tool' ? toolResult.parts[0]?.output : undefined
    expect(output).toContain('[Tool output shortened for model context.]')
    expect(Buffer.byteLength(output ?? '')).toBeLessThanOrEqual(64 * 1024)
  })

  it('reports each completed tool call for durable session tracing', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'mico-tool-runner-'))
    temporaryPaths.push(cwd)
    await writeFile(join(cwd, 'a.txt'), 'contents')
    const traces: Array<{
      toolCallId: string
      toolName: string
      input: ToolCall['input']
      output: string
      isError: boolean
      startedAt: number
      finishedAt: number
    }> = []
    let requestCount = 0
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      stream: async () => {
        requestCount += 1
        return requestCount === 1
          ? streamFrom([
              // SAFETY: this fixture matches the provider's documented completed tool-call chunk.
              {
                type: 'tool-input-available',
                toolCallId: 'call-1',
                toolName: 'read',
                input: { path: 'a.txt' }
              } as UIMessageChunk
            ])
          : streamFrom([])
      }
    }

    await new ToolAgentRunner().run({
      conversationKey: 'test-session',
      provider,
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Read a.txt' }] }],
      registry: ToolRegistry.forWorkspace(cwd),
      thinkingEffort: 'none',
      signal: new AbortController().signal,
      emit: () => undefined,
      onToolResult: (trace) => traces.push(trace)
    })

    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'read',
      input: { path: 'a.txt' },
      output: 'contents',
      isError: false
    })
    expect(traces[0]?.finishedAt).toBeGreaterThanOrEqual(traces[0]?.startedAt ?? Infinity)
  })

  it('rejects tool calls when the conversation has no project workspace', async () => {
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      stream: async () =>
        streamFrom([
          // SAFETY: this fixture matches the provider's documented completed tool-call chunk.
          {
            type: 'tool-input-available',
            toolCallId: 'call-1',
            toolName: 'read',
            input: { path: 'a.txt' }
          } as UIMessageChunk
        ])
    }

    await expect(
      new ToolAgentRunner().run({
        conversationKey: 'test-session',
        provider,
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Read a.txt' }] }],
        thinkingEffort: 'none',
        signal: new AbortController().signal,
        emit: () => undefined
      })
    ).rejects.toThrow('The model requested a tool outside a project session.')
  })

  it('waits for the provider response to finish before it starts a tool', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'mico-tool-runner-'))
    temporaryPaths.push(cwd)
    const events: string[] = []
    let requestCount = 0
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      stream: async () => {
        requestCount += 1
        return requestCount === 1
          ? streamWithCompletedToolCall(
              events,
              process.platform === 'win32' ? 'echo done' : 'printf done'
            )
          : streamFrom([{ type: 'text-delta', id: 'answer', delta: 'done' }])
      }
    }

    const result = await new ToolAgentRunner().run({
      conversationKey: 'test-session',
      provider,
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Run a command.' }] }],
      registry: ToolRegistry.forWorkspace(cwd),
      thinkingEffort: 'none',
      signal: new AbortController().signal,
      emit: () => undefined,
      onStep: () => events.push('step'),
      onToolResult: () => events.push('tool')
    })

    expect(result.assistantText).toBe('done')
    expect(events).toEqual(['stream-complete', 'step', 'tool'])
  })

  it('continues one length-limited text response before returning the answer', async () => {
    const requests: ChatProviderStreamInput[] = []
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      stream: async (input) => {
        requests.push(input)
        return requests.length === 1
          ? streamFrom([
              { type: 'text-delta', id: 'answer', delta: 'Partial answer. ' },
              // SAFETY: this fixture models the AI SDK terminal chunk emitted for max output tokens.
              { type: 'finish', finishReason: 'length' } as UIMessageChunk
            ])
          : streamFrom([{ type: 'text-delta', id: 'answer', delta: 'Completed.' }])
      }
    }

    const result = await new ToolAgentRunner().run({
      conversationKey: 'test-session',
      provider,
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Answer fully.' }] }],
      thinkingEffort: 'none',
      signal: new AbortController().signal,
      emit: () => undefined
    })

    expect(result.assistantText).toBe('Partial answer. Completed.')
    expect(requests).toHaveLength(2)
    expect(requests[1]?.messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Answer fully.' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'Partial answer. ' }] },
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'Output token limit hit. Resume directly from where you stopped. Do not apologize or recap.'
          }
        ]
      }
    ])
  })

  it('fails after one output-token recovery instead of looping indefinitely', async () => {
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      // SAFETY: this fixture models the AI SDK terminal chunk emitted for max output tokens.
      stream: async () => streamFrom([{ type: 'finish', finishReason: 'length' } as UIMessageChunk])
    }

    await expect(
      new ToolAgentRunner().run({
        conversationKey: 'test-session',
        provider,
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Answer fully.' }] }],
        thinkingEffort: 'none',
        signal: new AbortController().signal,
        emit: () => undefined
      })
    ).rejects.toThrow('output token limit twice')
  })
})

async function* streamWithCompletedToolCall(
  events: string[],
  command: string
): AsyncIterable<UIMessageChunk> {
  // SAFETY: this fixture matches the provider's documented completed tool-call chunk.
  yield {
    type: 'tool-input-available',
    toolCallId: 'call-streaming',
    toolName: 'bash',
    input: { command }
  } as UIMessageChunk
  events.push('stream-complete')
}
