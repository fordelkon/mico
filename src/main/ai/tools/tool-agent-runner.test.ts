import { writeFile } from 'node:fs/promises'
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
import { createTemporaryWorkspace, removeTemporaryPaths } from './test-helpers'

type RunnerInput = Parameters<ToolAgentRunner['run']>[0]

async function* streamFrom(chunks: ProviderStreamPart[]): AsyncIterable<ProviderStreamPart> {
  yield* chunks
}

function createScriptedProvider(
  turns: Array<ProviderStreamPart[] | AsyncIterable<UIMessageChunk>>,
  requests: ChatProviderStreamInput[] = []
): ChatProvider {
  return {
    getModelCapabilities: async () => null,
    stream: async (input) => {
      requests.push(input)
      const turn = turns[Math.min(requests.length, turns.length) - 1]
      return Array.isArray(turn) ? streamFrom(turn) : turn
    }
  }
}

function createRunInput(
  provider: ChatProvider,
  userText: string,
  overrides: Partial<RunnerInput> = {}
): RunnerInput {
  return {
    conversationKey: 'test-session',
    provider,
    messages: [{ role: 'user', parts: [{ type: 'text', text: userText }] }],
    thinkingEffort: 'none',
    signal: new AbortController().signal,
    emit: () => undefined,
    ...overrides
  }
}

describe('ToolAgentRunner', () => {
  afterEach(() => removeTemporaryPaths())

  it('user sees reasoning and text when no tools are called, then the turn completes', async () => {
    const onStep = vi.fn<NonNullable<RunnerInput['onStep']>>()
    const provider = createScriptedProvider([
      [
        // SAFETY: this fixture conforms to the documented reasoning-start UI chunk.
        { type: 'reasoning-start', id: 'reasoning-1' } as UIMessageChunk,
        // SAFETY: this fixture conforms to the documented reasoning-delta UI chunk.
        {
          type: 'reasoning-delta',
          id: 'reasoning-1',
          delta: 'Visible thought.'
        } as UIMessageChunk,
        // SAFETY: this fixture conforms to the documented reasoning-end UI chunk.
        { type: 'reasoning-end', id: 'reasoning-1' } as UIMessageChunk,
        { type: 'text-delta', id: 'answer', delta: 'Done.' },
        providerFinish({
          reason: 'stop',
          continuation: { provider: 'openai-responses', responseId: 'resp-1' }
        })
      ]
    ])

    // SAFETY: the test adds the proposed callback to an otherwise valid runner input.
    const result = await new ToolAgentRunner().run(createRunInput(provider, 'Answer.', { onStep }))

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

  it('user sees tool history replayed when the model is re-prompted, then it continues', async () => {
    const cwd = await createTemporaryWorkspace('mico-tool-runner-')
    await writeFile(join(cwd, 'a.txt'), 'contents')
    const calls: ChatProviderStreamInput[] = []
    const emitted: UIMessageChunk[] = []
    const steps: unknown[] = []
    const provider = createScriptedProvider(
      [
        [
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
        ],
        [{ type: 'text-delta', id: 'answer', delta: 'done' }]
      ],
      calls
    )

    const result = await new ToolAgentRunner().run(
      createRunInput(provider, 'Read a.txt', {
        registry: ToolRegistry.forWorkspace(cwd),
        emit: (chunk) => emitted.push(chunk),
        onStep: (step) => steps.push(step)
      })
    )

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
        type: 'data-tool-output-delta',
        id: 'call-1',
        data: {
          toolCallId: 'call-1',
          toolName: 'read',
          stream: 'preview',
          delta: 'contents'
        },
        transient: true
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

  it('user still gets an answer when the tool budget is hit, then tools are dropped', async () => {
    const cwd = await createTemporaryWorkspace('mico-tool-runner-')
    const requests: ChatProviderStreamInput[] = []
    const emitted: UIMessageChunk[] = []
    const provider = createScriptedProvider(
      [
        // SAFETY: every generated fixture is a complete documented tool-input-available UI chunk.
        Array.from(
          { length: 65 },
          (_, index) =>
            ({
              type: 'tool-input-available',
              toolCallId: `call-${index}`,
              toolName: 'read',
              input: { path: `file-${index}.txt` }
            }) as UIMessageChunk
        ),
        [{ type: 'text-delta', id: 'answer', delta: 'Best effort answer.' }]
      ],
      requests
    )

    const result = await new ToolAgentRunner().run(
      createRunInput(provider, 'Inspect every file.', {
        registry: ToolRegistry.forWorkspace(cwd),
        emit: (chunk) => emitted.push(chunk)
      })
    )

    expect(result.assistantText).toBe('Best effort answer.')
    expect(requests).toHaveLength(2)
    expect(requests[1]?.tools).toBeUndefined()
    expect(emitted.filter((chunk) => chunk.type === 'tool-output-error')).toHaveLength(65)
  })

  it('user keeps model context small when tool output is huge, then it is bounded', async () => {
    const cwd = await createTemporaryWorkspace('mico-tool-runner-')
    await writeFile(join(cwd, 'large.txt'), 'x'.repeat(70 * 1024))
    const requests: ChatProviderStreamInput[] = []
    const provider = createScriptedProvider(
      [
        [
          // SAFETY: this fixture matches the provider's documented completed tool-call chunk.
          {
            type: 'tool-input-available',
            toolCallId: 'call-large',
            toolName: 'read',
            input: { path: 'large.txt', limit: 2_000 }
          } as UIMessageChunk
        ],
        [{ type: 'text-delta', id: 'answer', delta: 'done' }]
      ],
      requests
    )

    await new ToolAgentRunner().run(
      createRunInput(provider, 'Read the file.', {
        registry: ToolRegistry.forWorkspace(cwd)
      })
    )

    const toolResult = requests[1]?.messages.at(-1)
    expect(toolResult).toMatchObject({ role: 'tool' })
    const output = toolResult?.role === 'tool' ? toolResult.parts[0]?.output : undefined
    expect(output).toContain('[Tool output shortened for model context.]')
    expect(Buffer.byteLength(output ?? '')).toBeLessThanOrEqual(64 * 1024)
  })

  it('user sees tool activity traced when a call completes, then the trace is reported', async () => {
    const cwd = await createTemporaryWorkspace('mico-tool-runner-')
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
    const provider = createScriptedProvider([
      [
        // SAFETY: this fixture matches the provider's documented completed tool-call chunk.
        {
          type: 'tool-input-available',
          toolCallId: 'call-1',
          toolName: 'read',
          input: { path: 'a.txt' }
        } as UIMessageChunk
      ],
      []
    ])

    await new ToolAgentRunner().run(
      createRunInput(provider, 'Read a.txt', {
        registry: ToolRegistry.forWorkspace(cwd),
        onToolResult: (trace) => traces.push(trace)
      })
    )

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

  it('user sees an error when tools are used outside a project, then the run fails', async () => {
    const provider = createScriptedProvider([
      [
        // SAFETY: this fixture matches the provider's documented completed tool-call chunk.
        {
          type: 'tool-input-available',
          toolCallId: 'call-1',
          toolName: 'read',
          input: { path: 'a.txt' }
        } as UIMessageChunk
      ]
    ])

    await expect(new ToolAgentRunner().run(createRunInput(provider, 'Read a.txt'))).rejects.toThrow(
      'The model requested a tool outside a project session.'
    )
  })

  it('user sees ordered events when a tool call lands, then it runs after the step', async () => {
    const cwd = await createTemporaryWorkspace('mico-tool-runner-')
    const events: string[] = []
    const provider = createScriptedProvider([
      streamWithCompletedToolCall(
        events,
        process.platform === 'win32' ? 'echo done' : 'printf done'
      ),
      [{ type: 'text-delta', id: 'answer', delta: 'done' }]
    ])

    const result = await new ToolAgentRunner().run(
      createRunInput(provider, 'Run a command.', {
        registry: ToolRegistry.forWorkspace(cwd),
        onStep: () => events.push('step'),
        onToolResult: () => events.push('tool')
      })
    )

    expect(result.assistantText).toBe('done')
    expect(events).toEqual(['stream-complete', 'step', 'tool'])
  })

  it('user gets a completed answer when the output limit is hit, then the run resumes', async () => {
    const requests: ChatProviderStreamInput[] = []
    const provider = createScriptedProvider(
      [
        [
          { type: 'text-delta', id: 'answer', delta: 'Partial answer. ' },
          // SAFETY: this fixture models the AI SDK terminal chunk emitted for max output tokens.
          { type: 'finish', finishReason: 'length' } as UIMessageChunk
        ],
        [{ type: 'text-delta', id: 'answer', delta: 'Completed.' }]
      ],
      requests
    )

    const result = await new ToolAgentRunner().run(createRunInput(provider, 'Answer fully.'))

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

  it('user sees a failure when the output limit is hit twice, then the run stops', async () => {
    const provider = createScriptedProvider([
      [
        // SAFETY: this fixture models the AI SDK terminal chunk emitted for max output tokens.
        { type: 'finish', finishReason: 'length' } as UIMessageChunk
      ],
      [
        // SAFETY: this fixture models the AI SDK terminal chunk emitted for max output tokens.
        { type: 'finish', finishReason: 'length' } as UIMessageChunk
      ]
    ])

    await expect(
      new ToolAgentRunner().run(createRunInput(provider, 'Answer fully.'))
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
