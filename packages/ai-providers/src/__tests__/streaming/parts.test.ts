import { describe, expect, it } from 'vitest'

import { createReasoningChunkEmitter } from '../../streaming/parts'

describe('reasoning chunk emitter', () => {
  it('opens, streams, and closes one reasoning part', () => {
    const emitter = createReasoningChunkEmitter(() => 'reasoning-1')

    expect(emitter.emitDelta('Inspect the request.')).toEqual([
      { type: 'reasoning-start', id: 'reasoning-1' },
      { type: 'reasoning-delta', id: 'reasoning-1', delta: 'Inspect the request.' }
    ])
    expect(emitter.finish()).toEqual([{ type: 'reasoning-end', id: 'reasoning-1' }])
  })
})
