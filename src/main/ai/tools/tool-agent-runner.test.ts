import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ChatProvider, ChatProviderStreamInput } from '@mico/ai-providers'
import type { UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ToolAgentRunner } from './tool-agent-runner'
import { ToolRegistry, type ToolCall } from './tool-registry'

async function* streamFrom(chunks: UIMessageChunk[]): AsyncIterable<UIMessageChunk> {
  yield* chunks
}

describe('ToolAgentRunner', () => {
  const temporaryPaths: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryPaths.splice(0).map((path) => rm(path, { force: true, recursive: true }))
    )
  })

  it('replays a completed call and result before the next provider request', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'mico-tool-runner-'))
    temporaryPaths.push(cwd)
    await writeFile(join(cwd, 'a.txt'), 'contents')
    const calls: ChatProviderStreamInput[] = []
    const emitted: UIMessageChunk[] = []
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
      emit: (chunk) => emitted.push(chunk)
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

  it('emits a tool result before the provider continues the stream', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'mico-tool-runner-'))
    temporaryPaths.push(cwd)
    let allowProviderToContinue: () => void = () => undefined
    const outputAvailable = new Promise<void>((resolve) => {
      allowProviderToContinue = resolve
    })
    let requestCount = 0
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      stream: async () => {
        requestCount += 1
        return requestCount === 1
          ? streamFromAfterToolResult(
              outputAvailable,
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
      emit: (chunk) => {
        if (chunk.type === 'tool-output-available') allowProviderToContinue()
      }
    })

    expect(result.assistantText).toBe('done')
  }, 1_000)
})

async function* streamFromAfterToolResult(
  outputAvailable: Promise<void>,
  command: string
): AsyncIterable<UIMessageChunk> {
  // SAFETY: this fixture matches the provider's documented completed tool-call chunk.
  yield {
    type: 'tool-input-available',
    toolCallId: 'call-streaming',
    toolName: 'bash',
    input: { command }
  } as UIMessageChunk
  await outputAvailable
}
