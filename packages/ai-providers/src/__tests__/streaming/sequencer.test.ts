import { describe, expect, it } from 'vitest'

import { createStreamSequencer } from '../../streaming/sequencer'

describe('stream sequencer', () => {
  it('user sees reasoning open and close before text opens when both stream, then the order holds', () => {
    const sequencer = createStreamSequencer(() => 'part-1')

    expect(sequencer.emitReasoning('Thinking.')).toEqual([
      { type: 'reasoning-start', id: 'part-1' },
      { type: 'reasoning-delta', id: 'part-1', delta: 'Thinking.' }
    ])
    expect(sequencer.emitText('Answer.')).toEqual([
      { type: 'reasoning-end', id: 'part-1' },
      { type: 'text-start', id: 'part-1' },
      { type: 'text-delta', id: 'part-1', delta: 'Answer.' }
    ])
  })

  it('user sees one reasoning close when text deltas arrive repeatedly, then text continues uninterrupted', () => {
    const sequencer = createStreamSequencer(() => 'part-1')

    sequencer.emitText('First.')
    expect(sequencer.emitText('Second.')).toEqual([
      { type: 'text-delta', id: 'part-1', delta: 'Second.' }
    ])
  })

  it('user sees both streams closed when the sequencer finishes, then a repeat closes nothing', () => {
    const sequencer = createStreamSequencer(() => 'part-1')

    sequencer.emitReasoning('Hidden.')
    sequencer.emitText('Answer.')
    expect(sequencer.finish()).toEqual([{ type: 'text-end', id: 'part-1' }])
    expect(sequencer.finish()).toEqual([])
  })

  it('user sees an empty close when nothing streamed, then no orphan chunks appear', () => {
    const sequencer = createStreamSequencer(() => 'part-1')

    expect(sequencer.finish()).toEqual([])
  })

  it('user sees reasoning replay metadata on the end chunk when the sequencer finishes, then signatures survive', () => {
    const sequencer = createStreamSequencer(() => 'part-1')

    sequencer.emitReasoning('Hidden.')
    expect(sequencer.finish({ anthropic: { signature: 'sig' } })).toEqual([
      {
        type: 'reasoning-end',
        id: 'part-1',
        providerMetadata: { anthropic: { signature: 'sig' } }
      }
    ])
  })
})
