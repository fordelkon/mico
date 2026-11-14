import type { ChatProvider, ChatProviderStreamInput, ProviderStreamPart } from '@mico/ai-providers'
import { describe, expect, it, vi } from 'vitest'
import { runModelLoop, type ModelLoopInput, type ToolExecutionPort } from './index'

function scriptedInput(
  turns: ProviderStreamPart[][],
  requests: ChatProviderStreamInput[] = []
): ModelLoopInput {
  const provider: ChatProvider = {
    getModelCapabilities: async () => null,
    stream: async (input) => {
      const turn = turns[requests.length]
      requests.push(input)
      return (async function* () {
        yield* turn
      })()
    }
  }
  return {
    provider,
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'Answer fully.' }] }],
    thinkingEffort: 'none',
    signal: new AbortController().signal,
    emit: () => undefined
  }
}

describe('runModelLoop', () => {
  it('user gets a completed answer when the output limit is hit, then the run resumes', async () => {
    const requests: ChatProviderStreamInput[] = []
    const input = scriptedInput(
      [
        [
          { type: 'text-delta', id: 'answer', delta: 'Partial answer. ' },
          { type: 'finish', finishReason: 'length' }
        ],
        [{ type: 'text-delta', id: 'answer', delta: 'Completed.' }]
      ],
      requests
    )

    const deltas: string[] = []
    await runModelLoop({
      ...input,
      emit: (chunk) => {
        if (chunk.type === 'text-delta') deltas.push(chunk.delta)
      }
    })

    expect(deltas).toEqual(['Partial answer. ', 'Completed.'])
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

  it('user requests a tool when recording model intent fails, then dispatch never starts', async () => {
    const input = scriptedInput([
      [
        {
          type: 'tool-input-available',
          toolCallId: 'read-1',
          toolName: 'Read',
          input: { path: 'notes.md' }
        }
      ]
    ])
    const executeBatch = vi.fn<ToolExecutionPort['executeBatch']>()
    const failure = new Error('Session storage is unavailable.')

    await expect(
      runModelLoop({
        ...input,
        registry: { executeBatch },
        journal: {
          recordModelStep: () => {
            throw failure
          },
          recordToolExecutionStarted: () => {},
          recordToolExecutionSettled: () => {}
        }
      })
    ).rejects.toBe(failure)
    expect(executeBatch).not.toHaveBeenCalled()
  })

  it('user sees a failure when the output limit is hit twice, then the run stops', async () => {
    const input = scriptedInput([
      [{ type: 'finish', finishReason: 'length' }],
      [{ type: 'finish', finishReason: 'length' }]
    ])

    await expect(runModelLoop(input)).rejects.toThrow('output token limit twice')
  })
})
