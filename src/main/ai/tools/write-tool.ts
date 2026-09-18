import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import * as z from 'zod'

import { MAX_WRITE_BYTES, type AgentTool } from './tool-contract'
import { resolveWorkspacePath } from './workspace-path-policy'

const WriteInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(4_096)
    .refine((value) => !value.includes('\0')),
  content: z
    .string()
    .refine((value) => new TextEncoder().encode(value).byteLength <= MAX_WRITE_BYTES)
})
type WriteInput = z.infer<typeof WriteInputSchema>

function createWriteTool(): AgentTool<WriteInput> {
  return {
    definition: {
      name: 'write',
      description:
        'Write UTF-8 content to a file in the project workspace. Creates parent directories.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
        additionalProperties: false
      }
    },
    inputSchema: WriteInputSchema,
    async execute({ path, content }, context) {
      context.signal.throwIfAborted()
      const target = await resolveWorkspacePath(context.cwd, path, { allowMissing: true })
      await mkdir(dirname(target), { recursive: true })
      context.signal.throwIfAborted()
      await writeFile(target, content, 'utf8')
      return { output: `Successfully wrote ${path}.` }
    }
  }
}

export { createWriteTool }
