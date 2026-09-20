import { readFile } from 'node:fs/promises'

import * as z from 'zod'

import {
  emitToolOutputDelta,
  MAX_READ_BYTES,
  MAX_READ_LINES,
  type AgentTool
} from './tool-contract'
import { resolveWorkspacePath } from './workspace-path-policy'

const ReadInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(4_096)
    .refine((value) => !value.includes('\0')),
  offset: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(MAX_READ_LINES).optional()
})
type ReadInput = z.infer<typeof ReadInputSchema>

function createReadTool(): AgentTool<ReadInput> {
  return {
    definition: {
      name: 'read',
      description:
        'Read a UTF-8 text file in the project workspace. Use offset and limit for large files.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          offset: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: MAX_READ_LINES }
        },
        required: ['path'],
        additionalProperties: false
      }
    },
    executionMode: 'parallel-safe',
    inputSchema: ReadInputSchema,
    async execute({ path, offset = 1, limit = MAX_READ_LINES }, context) {
      context.signal.throwIfAborted()
      const target = await resolveWorkspacePath(context.cwd, path)
      const bytes = await readFile(target)
      if (bytes.byteLength > MAX_READ_BYTES)
        throw new Error(`File is larger than the ${MAX_READ_BYTES / 1024} KiB read limit.`)
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        throw new Error('File is not valid UTF-8 text.')
      }
      const lines = text.split('\n')
      const start = offset - 1
      if (start >= lines.length) throw new Error(`Offset ${offset} is beyond the end of the file.`)
      const selected = lines.slice(start, start + limit)
      const nextOffset = start + selected.length + 1
      const suffix =
        nextOffset <= lines.length ? `\n\n[More content available. Use offset=${nextOffset}.]` : ''
      const output = selected.join('\n') + suffix
      emitToolOutputDelta(context, { stream: 'preview', delta: output })
      return { output }
    }
  }
}

export { createReadTool }
