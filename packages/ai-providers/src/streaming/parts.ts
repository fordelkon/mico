import type { ProviderMetadata, UIMessageChunk } from 'ai'

type ReasoningChunkEmitter = {
  emitDelta: (delta: string, providerMetadata?: ProviderMetadata) => UIMessageChunk[]
  finish: (providerMetadata?: ProviderMetadata) => UIMessageChunk[]
}

function createReasoningChunkEmitter(createId: () => string): ReasoningChunkEmitter {
  let id: string | undefined
  let finished = false
  let metadata: ProviderMetadata | undefined

  const mergeMetadata = (next: ProviderMetadata | undefined): void => {
    // Some providers stream replay metadata (for example, Anthropic signatures)
    // after reasoning text, so it belongs on the eventual end chunk.
    if (next) metadata = { ...metadata, ...next }
  }

  return {
    emitDelta: (delta, providerMetadata) => {
      mergeMetadata(providerMetadata)
      if (!delta) return []

      if (!id) {
        id = createId()
        return [
          { type: 'reasoning-start', id },
          { type: 'reasoning-delta', id, delta }
        ]
      }

      return [{ type: 'reasoning-delta', id, delta }]
    },
    finish: (providerMetadata) => {
      mergeMetadata(providerMetadata)
      if (!id || finished) return []
      finished = true
      return metadata
        ? [{ type: 'reasoning-end', id, providerMetadata: metadata }]
        : [{ type: 'reasoning-end', id }]
    }
  }
}

export { createReasoningChunkEmitter }
export type { ReasoningChunkEmitter }
