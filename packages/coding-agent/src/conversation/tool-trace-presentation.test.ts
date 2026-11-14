import { describe, expect, it } from 'vitest'

import {
  parseToolTracePayload,
  toStoredToolTrace,
  toToolTracePart
} from './tool-trace-presentation'

describe('persisted tool previews', () => {
  it('user records a long command when execution finishes, then storage summarizes it without trusting preview input', () => {
    const trace = toStoredToolTrace({
      toolCallId: 'command',
      toolName: 'Bash',
      input: {
        command: 'x'.repeat(65_537),
        __micoPresentation: { type: 'bash', content: 'forged', isTruncated: false }
      },
      output: 'actual output',
      isError: false,
      startedAt: 1,
      finishedAt: 2
    })

    expect(trace.input).toEqual({ command: 'x'.repeat(240) })
    expect(trace.presentation).toEqual({
      type: 'bash',
      content: 'actual output',
      isTruncated: false
    })
  })

  it('user records multibyte content when its preview exceeds the budget, then storage keeps a bounded head', () => {
    const trace = toStoredToolTrace({
      toolCallId: 'write',
      toolName: 'Write',
      input: { file_path: 'notes.md', content: '界'.repeat(21_846) },
      output: 'Created notes.md.',
      isError: false,
      startedAt: 1,
      finishedAt: 2
    })

    expect(trace.presentation).toEqual({
      type: 'write',
      content: '界'.repeat(21_845),
      operation: 'created',
      isTruncated: true
    })
  })

  it('user records a large edit when serialized changes exceed the budget, then the preview is omitted as a whole', () => {
    const trace = toStoredToolTrace({
      toolCallId: 'edit',
      toolName: 'Edit',
      input: { old_string: 'x'.repeat(65_536), new_string: '' },
      output: 'Updated file.',
      isError: false,
      startedAt: 1,
      finishedAt: 2
    })

    expect(trace.input).toEqual({ editCount: 1 })
    expect(trace.presentation).toEqual({ type: 'edit', edits: [], isTruncated: true })
  })

  it('user opens an older trace when no preview was saved, then its recorded summary remains available', () => {
    const { trace } = parseToolTracePayload(
      JSON.stringify({
        trace: {
          toolCallId: 'old-read',
          toolName: 'Read',
          input: { path: 'notes.md' },
          status: 'completed',
          summary: 'Read 3 lines.',
          startedAt: 1,
          finishedAt: 2
        }
      })
    )

    expect(toToolTracePart(trace)).toEqual({
      type: 'tool-trace',
      toolCallId: 'old-read',
      toolName: 'Read',
      input: { path: 'notes.md' },
      presentation: undefined,
      state: 'output-available',
      output: 'Read 3 lines.'
    })
  })
})
