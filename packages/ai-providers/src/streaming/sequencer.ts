import type { ProviderMetadata, UIMessageChunk } from 'ai'

import { createReasoningChunkEmitter } from './parts'
import { createTextChunkEmitter } from './text-chunks'

/**
 * Pairs the reasoning and text emitters for linear protocols and owns their one
 * ordering invariant: reasoning closes before text opens. Adapters report
 * reasoning and answer text without knowing about start/end chunk lifecycles.
 */
type StreamSequencer = {
  emitReasoning: (delta: string, providerMetadata?: ProviderMetadata) => UIMessageChunk[]
  emitText: (delta: string) => UIMessageChunk[]
  finish: (providerMetadata?: ProviderMetadata) => UIMessageChunk[]
}

function createStreamSequencer(createId: () => string): StreamSequencer {
  const reasoning = createReasoningChunkEmitter(createId)
  const text = createTextChunkEmitter(createId)
  let finished = false
  return {
    emitReasoning: (delta, providerMetadata) => reasoning.emitDelta(delta, providerMetadata),
    emitText: (delta) => [...reasoning.finish(), ...text.emitDelta(delta)],
    finish: (providerMetadata) => {
      if (finished) return []
      finished = true
      return [...reasoning.finish(providerMetadata), ...text.finish()]
    }
  }
}

export { createStreamSequencer }
export type { StreamSequencer }
