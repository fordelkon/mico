import type { UIMessageChunk } from 'ai'

type TextChunkEmitter = {
  emitDelta: (delta: string) => UIMessageChunk[]
  finish: () => UIMessageChunk[]
}

function createTextChunkEmitter(createId: () => string): TextChunkEmitter {
  let id: string | undefined

  return {
    emitDelta: (delta) => {
      if (!delta) return []

      if (!id) {
        id = createId()
        return [
          { type: 'text-start', id },
          { type: 'text-delta', id, delta }
        ]
      }

      return [{ type: 'text-delta', id, delta }]
    },
    finish: () => (id ? [{ type: 'text-end', id }] : [])
  }
}

export { createTextChunkEmitter }
export type { TextChunkEmitter }
