import { describe, expect, it } from 'vitest'
import { TurnDisplayAssembler } from './turn-display-assembler'

const trace = (output: string) => ({
  toolCallId: 'same',
  toolName: 'Glob',
  input: {},
  output,
  isError: false,
  startedAt: 1,
  finishedAt: 2
})
describe('TurnDisplayAssembler', () => {
  it('user sees a repeated call identity when two steps settle, then each position keeps its own result', () => {
    const assembler = new TurnDisplayAssembler(1000)
    assembler.observeChunk({
      type: 'tool-input-available',
      toolCallId: 'same',
      toolName: 'Glob',
      input: {},
      dynamic: true
    })
    assembler.recordTrace(trace('first'))
    assembler.observeChunk({
      type: 'tool-input-available',
      toolCallId: 'same',
      toolName: 'Glob',
      input: {},
      dynamic: true
    })
    assembler.recordTrace(trace('second'))
    expect(assembler.buildMessage('stopped')?.parts).toMatchObject([
      { output: 'first' },
      { output: 'second' }
    ])
  })
  it('user receives invalid arguments when a tool call finishes, then its failure appears in the saved transcript', () => {
    const assembler = new TurnDisplayAssembler(1000)
    assembler.observeChunk({
      type: 'tool-input-error',
      toolCallId: 'same',
      toolName: 'Glob',
      input: '{bad',
      errorText: 'Invalid JSON',
      dynamic: true
    })
    assembler.recordTrace({ ...trace('Invalid JSON'), isError: true })
    expect(assembler.buildMessage('stopped')?.parts).toMatchObject([
      { type: 'tool-trace', state: 'output-error', errorText: 'Tool execution failed.' }
    ])
  })
})
