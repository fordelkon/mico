import { describe, expect, it } from 'vitest'

import { createTaggedThinkingExtractor } from '../../streaming/tagged-thinking'

describe('tagged thinking extractor', () => {
  it('separates a thinking tag split across input deltas', () => {
    const extractor = createTaggedThinkingExtractor()

    expect(extractor.push('Before <think>inspect')).toEqual([
      { type: 'text', delta: 'Before ' },
      { type: 'reasoning', delta: 'inspect' }
    ])
    expect(extractor.push(' the input</think> after')).toEqual([
      { type: 'reasoning', delta: ' the input' },
      { type: 'text', delta: ' after' }
    ])
    expect(extractor.finish()).toEqual([])
  })
})
