import { describe, expect, it } from 'vitest'

import { createToolCallAssembler } from '../../streaming/tool-calls'

describe('tool call assembler', () => {
  it('user sees one start per call when the adapter starts it twice, then no duplicate opens', () => {
    const assembler = createToolCallAssembler('invalid arguments.')

    expect(assembler.start('call-1', 'read')).toEqual([
      { type: 'tool-input-start', toolCallId: 'call-1', toolName: 'read' }
    ])
    expect(assembler.start('call-1', 'read')).toEqual([])
  })

  it('user sees completed arguments when the call finishes, then the parsed input arrives', () => {
    const assembler = createToolCallAssembler('invalid arguments.')

    expect(assembler.completeJson('call-1', 'read', '{"path":"a.ts"}')).toEqual([
      {
        type: 'tool-input-available',
        toolCallId: 'call-1',
        toolName: 'read',
        input: { path: 'a.ts' }
      }
    ])
  })

  it('user sees a tool-input-error when arguments fail to parse, then the raw text is preserved', () => {
    const assembler = createToolCallAssembler('The provider returned invalid tool arguments.')

    expect(assembler.completeJson('call-1', 'read', '{broken')).toEqual([
      {
        type: 'tool-input-error',
        toolCallId: 'call-1',
        toolName: 'read',
        input: '{broken',
        errorText: 'The provider returned invalid tool arguments.'
      }
    ])
  })

  it('user sees the protocol error chunk when a pre-parsed argument fails its shape check, then the raw value is preserved', () => {
    const assembler = createToolCallAssembler('invalid arguments.')

    expect(assembler.completeValue('call-1', 'read', { isValid: false, invalidInput: 42 })).toEqual(
      [
        {
          type: 'tool-input-error',
          toolCallId: 'call-1',
          toolName: 'read',
          input: 42,
          errorText: 'invalid arguments.'
        }
      ]
    )
    expect(
      assembler.completeValue('call-1', 'read', { isValid: true, input: { path: 'a.ts' } })
    ).toEqual([
      {
        type: 'tool-input-available',
        toolCallId: 'call-1',
        toolName: 'read',
        input: { path: 'a.ts' }
      }
    ])
  })
})
