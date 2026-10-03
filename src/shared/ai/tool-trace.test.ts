import { describe, expect, it } from 'vitest'

import {
  getToolTracePresentation,
  ToolTraceInputSchema,
  ToolTraceSourceInputSchema
} from './tool-trace'

describe('tool trace interpretation', () => {
  it('user receives overlapping input fields when a tool runs, then canonical fields take precedence', () => {
    const input = ToolTraceInputSchema.parse({
      file_path: 'current.ts',
      path: 'previous.ts',
      pattern: 'current pattern',
      query: 'previous query',
      old_string: 'removed'
    })

    expect(input.path).toBe('current.ts')
    expect(input.query).toBe('current pattern')
    expect(getToolTracePresentation('Edit', input, undefined)).toEqual({
      type: 'edit',
      edits: [{ oldText: 'removed', newText: '' }],
      isTruncated: false
    })
  })

  it('user revisits a saved trace when a summary replaces output, then its saved preview wins', () => {
    const input = ToolTraceInputSchema.parse({
      content: 'draft',
      __micoPresentation: {
        type: 'write',
        content: 'saved preview',
        operation: 'created',
        isTruncated: true
      }
    })

    expect(getToolTracePresentation('Write', input, 'Wrote file.')).toEqual({
      type: 'write',
      content: 'saved preview',
      operation: 'created',
      isTruncated: true
    })
  })

  it('user receives oversized live metadata when a trace arrives, then display rejects it before normalization', () => {
    expect(ToolTraceInputSchema.safeParse({ command: 'x'.repeat(65_537) }).success).toBe(false)
    expect(
      ToolTraceInputSchema.safeParse({ file_path: 'current.ts', path: 'x'.repeat(4_097) }).success
    ).toBe(false)
    expect(ToolTraceInputSchema.parse({ file_path: 'x'.repeat(4_097) }).path).toHaveLength(4_097)
    expect(
      ToolTraceSourceInputSchema.parse({ command: 'x'.repeat(65_537), path: 'x'.repeat(4_097) })
    ).toMatchObject({ command: 'x'.repeat(65_537), path: 'x'.repeat(4_097) })
  })

  it('user receives an invalid saved preview when loading a trace, then display rejects the input', () => {
    expect(
      ToolTraceInputSchema.safeParse({
        __micoPresentation: { type: 'bash', content: 'x'.repeat(65_537), isTruncated: false }
      }).success
    ).toBe(false)
  })

  it('user watches a draft when output has not arrived, then only available preview content is exposed', () => {
    expect(
      getToolTracePresentation('Bash', ToolTraceInputSchema.parse({ command: 'ls' }), undefined)
    ).toEqual({ type: 'bash', content: '', isTruncated: false })
    expect(
      getToolTracePresentation('Edit', ToolTraceInputSchema.parse({}), undefined)
    ).toBeUndefined()
    expect(
      getToolTracePresentation('Read', ToolTraceInputSchema.parse({}), undefined)
    ).toBeUndefined()
    expect(
      getToolTracePresentation('Write', ToolTraceInputSchema.parse({ content: '' }), undefined)
    ).toEqual({ type: 'write', content: '', operation: 'unknown', isTruncated: false })
  })
})
