import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  type ChatProvider,
  type ChatProviderStreamInput,
  ProviderError,
  type ProviderStreamPart,
  providerFinish
} from '@mico/ai-providers'
import type { UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTemporaryWorkspace, removeTemporaryPaths } from './test-helpers'
import { ModelLoop } from './model-loop'
import { type ToolCall, Workspaces } from '../workspace'

type RunnerInput = Parameters<ModelLoop['run']>[0]

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
    provider,
    messages: [{ role: 'user', parts: [{ type: 'text', text: userText }] }],
    thinkingEffort: 'none',
    signal: new AbortController().signal,
    emit: () => undefined,
    ...overrides
  }
}

describe('ModelLoop', () => {
  afterEach(() => removeTemporaryPaths())

  it('user continues after an output limit when usage is absent, then each prepared step is measured', async () => {
    const observations: Array<{ estimatedInputTokens: number }> = []
    const provider = createScriptedProvider([
      [providerFinish({ reason: 'length' })],
      [providerFinish({ reason: 'stop' })]
    ])
    await new ModelLoop().run(
      createRunInput(provider, 'abcd', {
        prepareMessages: (history) => [
          { role: 'system', parts: [{ type: 'text', text: 'abcd'.repeat(20) }] },
          ...history
        ],
        onContextMeasurement: (measurement) => observations.push(measurement)
      })
    )
    expect(observations).toHaveLength(2)
    expect(observations[0].estimatedInputTokens).toBe(24)
    expect(observations[1].estimatedInputTokens).toBeGreaterThan(24)
  })

  it('user receives an unknown legacy finish when the stream ends, then completion is rejected', async () => {
    await expect(
      new ModelLoop().run(
        createRunInput(
          // SAFETY: exercises a legacy finish category received at the runtime boundary.
          createScriptedProvider([
            [JSON.parse('{"type":"finish","finishReason":"unknown"}') as UIMessageChunk]
          ]),
          'Answer'
        )
      )
    ).rejects.toThrow('provider')
  })

  it('user exceeds context when requesting a response, then history stays intact and no request is reissued', async () => {
    const requests: ChatProviderStreamInput[] = []
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      stream: async (input) => {
        requests.push(input)
        throw new ProviderError('context_overflow')
      }
    }
    const journal: NonNullable<RunnerInput['journal']> = {
      recordModelStep: () => undefined,
      recordToolExecutionStarted: () => undefined,
      recordToolExecutionSettled: () => undefined
    }
    await expect(
      new ModelLoop().run(
        createRunInput(provider, 'request', {
          messages: [
            { role: 'user', parts: [{ type: 'text', text: 'old'.repeat(1000) }] },
            { role: 'assistant', parts: [{ type: 'text', text: 'old answer' }] },
            { role: 'user', parts: [{ type: 'text', text: 'request' }] }
          ],
          journal,
          prepareMessages: (history) => [
            { role: 'system', parts: [{ type: 'text', text: 'ephemeral system' }] },
            ...history,
            { role: 'user', parts: [{ type: 'text', text: 'fresh guidance' }] }
          ]
        })
      )
    ).rejects.toThrow('context limit')
    expect(requests).toHaveLength(1)
    expect(JSON.stringify(requests[0].messages)).toContain('old answer')
    expect(requests[0].messages.at(-1)).toMatchObject({
      parts: [{ type: 'text', text: 'fresh guidance' }]
    })
  })

  it('user retries after a tool completes when the next model request fails, then the tool runs once', async () => {
    const cwd = await createTemporaryWorkspace('mico-retry-tool-')
    await writeFile(join(cwd, 'a.txt'), 'contents')
    let requests = 0
    const traces: string[] = []
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      stream: async () => {
        requests += 1
        if (requests === 1)
          return streamFrom([
            {
              type: 'tool-input-available',
              toolCallId: 'a',
              toolName: 'Read',
              input: { file_path: 'a.txt' },
              dynamic: true
            }
          ])
        if (requests === 2) throw new TypeError('fetch failed')
        return streamFrom([{ type: 'text-delta', id: 'answer', delta: 'done' }])
      }
    }
    const result = await new ModelLoop().run(
      createRunInput(provider, 'Read the file', {
        registry: (await Workspaces.enterTurn(cwd)).registry,
        retryDelayMs: 0,
        onToolResult: (trace) => traces.push(trace.toolCallId)
      })
    )
    expect(result.assistantText).toBe('done')
    expect(traces).toEqual(['a'])
    expect(requests).toBe(3)
  })

  it('user receives malformed tool arguments when the model finishes a call, then a failed pair is replayed without execution', async () => {
    const cwd = await createTemporaryWorkspace('mico-malformed-tool-')
    const requests: ChatProviderStreamInput[] = []
    const provider = createScriptedProvider(
      [
        [
          {
            type: 'tool-input-error',
            toolCallId: 'bad',
            toolName: 'Write',
            input: { file_path: 'output.txt', content: 'must not execute', invalid: true },
            errorText: 'Invalid JSON arguments.'
          }
        ],
        [{ type: 'text-delta', id: 'answer', delta: 'corrected' }]
      ],
      requests
    )
    const result = await new ModelLoop().run(
      createRunInput(provider, 'Write safely', {
        registry: (await Workspaces.enterTurn(cwd, { permissionMode: 'acceptEdits' })).registry
      })
    )
    await expect(access(join(cwd, 'output.txt'))).rejects.toThrow('ENOENT')
    expect(result.assistantText).toBe('corrected')
    expect(requests[1].messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Write safely' }] },
      {
        role: 'assistant',
        parts: [{ type: 'tool-call', toolCallId: 'bad', toolName: 'Write', argumentsJson: '{}' }]
      },
      {
        role: 'tool',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'bad',
            toolName: 'Write',
            output: expect.stringContaining('Invalid JSON'),
            isError: true
          }
        ]
      }
    ])
  })

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
    const result = await new ModelLoop().run(createRunInput(provider, 'Answer.', { onStep }))

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
    expect(onStep).toHaveBeenCalledExactlyOnceWith({
      index: 1,
      assistant: result.finalAssistant,
      toolResults: []
    })
  })

  it('user sees reasoning, tools and text interleave when a turn spans tool steps, then stream positions are kept', async () => {
    const cwd = await createTemporaryWorkspace('mico-tool-runner-')
    await writeFile(join(cwd, 'a.txt'), 'contents')
    const provider = createScriptedProvider([
      [
        // SAFETY: these fixtures conform to the documented reasoning UI chunks.
        { type: 'reasoning-start', id: 'reasoning-1' } as UIMessageChunk,
        // SAFETY: this fixture continues the documented reasoning stream above.
        {
          type: 'reasoning-delta',
          id: 'reasoning-1',
          delta: 'Read the file first.'
        } as UIMessageChunk,
        // SAFETY: this fixture closes the documented reasoning stream above.
        { type: 'reasoning-end', id: 'reasoning-1' } as UIMessageChunk,
        // SAFETY: this fixture matches the provider's documented completed tool-call chunk.
        {
          type: 'tool-input-available',
          toolCallId: 'call-1',
          toolName: 'Read',
          input: { file_path: 'a.txt' }
        } as UIMessageChunk
      ],
      [{ type: 'text-delta', id: 'answer', delta: 'done' }]
    ])

    const result = await new ModelLoop().run(
      createRunInput(provider, 'Read a.txt', {
        registry: (await Workspaces.enterTurn(cwd)).registry
      })
    )

    expect(result.displaySequence).toEqual([
      { type: 'reasoning', text: 'Read the file first.' },
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'Read' },
      { type: 'text', textId: 'answer', text: 'done' }
    ])
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
            toolName: 'Read'
          } as UIMessageChunk,
          // SAFETY: this fixture continues the preceding documented dynamic-tool input stream.
          {
            type: 'tool-input-delta',
            toolCallId: 'call-1',
            inputTextDelta: '{"file_path":"a.txt"}'
          } as UIMessageChunk,
          // SAFETY: this fixture completes the preceding documented dynamic-tool input stream.
          {
            type: 'tool-input-available',
            toolCallId: 'call-1',
            toolName: 'Read',
            input: { file_path: 'a.txt' }
          } as UIMessageChunk
        ],
        [{ type: 'text-delta', id: 'answer', delta: 'done' }]
      ],
      calls
    )

    const result = await new ModelLoop().run(
      createRunInput(provider, 'Read a.txt', {
        registry: (await Workspaces.enterTurn(cwd)).registry,
        emit: (chunk) => emitted.push(chunk),
        onStep: (step) => steps.push(step)
      })
    )

    expect(result.assistantText).toBe('done')
    expect(emitted).toEqual([
      {
        type: 'tool-input-start',
        toolCallId: 'call-1',
        toolName: 'Read',
        dynamic: true
      },
      {
        type: 'tool-input-delta',
        toolCallId: 'call-1',
        inputTextDelta: '{"file_path":"a.txt"}'
      },
      {
        type: 'tool-input-available',
        toolCallId: 'call-1',
        toolName: 'Read',
        input: { file_path: 'a.txt' },
        dynamic: true
      },
      {
        type: 'data-tool-output-delta',
        data: {
          toolCallId: 'call-1',
          toolName: 'Read',
          stream: 'preview',
          delta: 'contents'
        }
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
      }),
      { index: 2, assistant: result.finalAssistant, toolResults: [] }
    ])
    expect(calls[1].messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Read a.txt' }] },
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'Read',
            argumentsJson: '{"file_path":"a.txt"}'
          }
        ]
      },
      {
        role: 'tool',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'Read',
            output: 'contents',
            isError: false
          }
        ]
      }
    ])
  })

  it('user needs many tool rounds when a task is long, then it completes with tools available throughout', async () => {
    const cwd = await createTemporaryWorkspace('mico-tool-runner-')
    await writeFile(join(cwd, 'a.txt'), 'contents')
    const requests: ChatProviderStreamInput[] = []
    const turns: ProviderStreamPart[][] = Array.from({ length: 30 }, (_, round) =>
      Array.from({ length: 3 }, (_, index) => ({
        type: 'tool-input-available',
        toolCallId: `call-${round}-${index}`,
        toolName: 'Read',
        input: { file_path: 'a.txt' },
        dynamic: true
      }))
    )
    turns.push([{ type: 'text-delta', id: 'answer', delta: 'Finished the task.' }])
    const emitted: UIMessageChunk[] = []

    const result = await new ModelLoop().run(
      createRunInput(createScriptedProvider(turns, requests), 'Inspect the project.', {
        registry: (await Workspaces.enterTurn(cwd)).registry,
        emit: (chunk) => emitted.push(chunk)
      })
    )

    expect(result.assistantText).toBe('Finished the task.')
    expect(requests).toHaveLength(31)
    expect(requests.every((input) => input.tools?.some((tool) => tool.name === 'Read'))).toBe(true)
    expect(emitted.filter((chunk) => chunk.type === 'tool-output-available')).toHaveLength(90)
    expect(requests.at(-1)?.messages.filter((message) => message.role === 'tool')).toHaveLength(30)
  })

  it('user stops a long tool loop when cancelling, then no further request starts', async () => {
    const cwd = await createTemporaryWorkspace('mico-tool-runner-')
    await writeFile(join(cwd, 'a.txt'), 'contents')
    const controller = new AbortController()
    const requests: ChatProviderStreamInput[] = []
    const provider = createScriptedProvider(
      [
        [
          {
            type: 'tool-input-available',
            toolCallId: 'read',
            toolName: 'Read',
            input: { file_path: 'a.txt' },
            dynamic: true
          }
        ]
      ],
      requests
    )
    let completed = 0

    await expect(
      new ModelLoop().run(
        createRunInput(provider, 'Keep inspecting.', {
          registry: (await Workspaces.enterTurn(cwd)).registry,
          signal: controller.signal,
          onToolResult: () => {
            completed += 1
            if (completed === 30) controller.abort(new Error('Stopped by user.'))
          }
        })
      )
    ).rejects.toThrow('Stopped by user.')

    expect(completed).toBe(30)
    expect(requests).toHaveLength(30)
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
            toolName: 'Read',
            input: { file_path: 'large.txt', limit: 2_000 }
          } as UIMessageChunk
        ],
        [{ type: 'text-delta', id: 'answer', delta: 'done' }]
      ],
      requests
    )

    await new ModelLoop().run(
      createRunInput(provider, 'Read the file.', {
        registry: (await Workspaces.enterTurn(cwd)).registry
      })
    )

    const toolResult = requests[1]?.messages.at(-1)
    expect(toolResult).toMatchObject({ role: 'tool' })
    const output = toolResult?.role === 'tool' ? toolResult.parts[0]?.output : undefined
    expect(output).toContain('[Tool output shortened for model context.]')
    expect(Buffer.byteLength(output ?? '')).toBeLessThanOrEqual(64 * 1024)
  })

  it.each(['LoadSkill', 'ReadSkillResource'])(
    'user loads a large skill through %s when requested, then its instructions reach the model intact',
    async (toolName) => {
      const cwd = await createTemporaryWorkspace('mico-tool-runner-')
      const root = join(cwd, '.agents/skills/review')
      await mkdir(root, { recursive: true })
      const body = 'y'.repeat(88 * 1024)
      await writeFile(
        join(root, 'SKILL.md'),
        `---\nname: review\ndescription: Review code\n---\n${body}`
      )
      const requests: ChatProviderStreamInput[] = []
      const provider = createScriptedProvider(
        [
          [
            // SAFETY: this fixture matches the provider's completed tool-call chunk.
            {
              type: 'tool-input-available',
              toolCallId: 'call-skill',
              toolName,
              input:
                toolName === 'LoadSkill'
                  ? { skill_id: 'review' }
                  : { skill_id: 'review', relative_path: 'SKILL.md' }
            } as UIMessageChunk
          ],
          [{ type: 'text-delta', id: 'answer', delta: 'done' }]
        ],
        requests
      )

      await new ModelLoop().run(
        createRunInput(provider, 'Load the skill.', {
          registry: (await Workspaces.enterTurn(cwd)).registry
        })
      )

      const toolResult = requests[1]?.messages.at(-1)
      const output = toolResult?.role === 'tool' ? toolResult.parts[0]?.output : undefined
      expect(output).toContain(body)
      expect(output).not.toContain('[Tool output shortened for model context.]')
    }
  )

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
          toolName: 'Read',
          input: { file_path: 'a.txt' }
        } as UIMessageChunk
      ],
      []
    ])

    await new ModelLoop().run(
      createRunInput(provider, 'Read a.txt', {
        registry: (await Workspaces.enterTurn(cwd)).registry,
        onToolResult: (trace) => traces.push(trace)
      })
    )

    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'Read',
      input: { file_path: 'a.txt' },
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
          toolName: 'Read',
          input: { file_path: 'a.txt' }
        } as UIMessageChunk
      ]
    ])

    await expect(new ModelLoop().run(createRunInput(provider, 'Read a.txt'))).rejects.toThrow(
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

    const result = await new ModelLoop().run(
      createRunInput(provider, 'Run a command.', {
        registry: (await Workspaces.enterTurn(cwd, { requestApproval: async () => true })).registry,
        onStep: () => events.push('step'),
        onToolResult: () => events.push('tool')
      })
    )

    expect(result.assistantText).toBe('done')
    expect(events).toEqual(['stream-complete', 'tool', 'step', 'step'])
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

    const result = await new ModelLoop().run(createRunInput(provider, 'Answer fully.'))

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

    await expect(new ModelLoop().run(createRunInput(provider, 'Answer fully.'))).rejects.toThrow(
      'output token limit twice'
    )
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
    toolName: 'Bash',
    input: { command }
  } as UIMessageChunk
  events.push('stream-complete')
}
