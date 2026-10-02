import { describe, expect, it } from 'vitest'

import { createTaggedThinkingExtractor } from '../../streaming/tagged-thinking'

describe('tagged thinking extractor', () => {
  it('user sees thinking split from text when a tag spans deltas, then text resumes', () => {
    const extractor = createTaggedThinkingExtractor()

    expect(extractor.push('Before <thi')).toEqual([{ type: 'text', delta: 'Before ' }])
    expect(extractor.push('nk>inspect the input</thi')).toEqual([
      { type: 'reasoning', delta: 'inspect the input' }
    ])
    expect(extractor.push('nk> after')).toEqual([{ type: 'text', delta: ' after' }])
    expect(extractor.finish()).toEqual([])
  })
})
