import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import * as z from 'zod'

import { defineAgentTool, emitToolOutputDelta, MAX_WRITE_BYTES, type AgentTool } from './contract'
import { resolveWorkspacePath } from './path-policy'

const WriteInputSchema = z.strictObject({
  file_path: z
    .string()
    .min(1)
    .max(4_096)
    .refine((value) => !value.includes('\0'))
    .describe(
      'Path of the file to create or overwrite inside the workspace; prefer an absolute path.'
    ),
  content: z
    .string()
    .refine((value) => new TextEncoder().encode(value).byteLength <= MAX_WRITE_BYTES)
    .describe('Complete UTF-8 file content. An empty string creates or clears an empty file.')
})
type WriteInput = z.infer<typeof WriteInputSchema>

function createWriteTool(): AgentTool<WriteInput> {
  return defineAgentTool({
    name: 'Write',
    description:
      'Create or overwrite a workspace file with complete UTF-8 content. Requires file_path and content. Creates parent directories. Read existing files before overwriting; prefer Edit for targeted replacements.',
    inputSchema: WriteInputSchema,
    operation: ({ file_path }) => ({ kind: 'file-write', path: file_path, allowMissing: true }),
    async execute({ file_path, content }, context) {
      context.signal.throwIfAborted()
      const { path: target } = await resolveWorkspacePath(context.cwd, file_path, {
        allowMissing: true
      })
      const existed = existsSync(target)
      // This is a preview of the already validated input, not a claim that the
      // file has been written. The final tool result remains the commit signal.
      emitToolOutputDelta(context, { stream: 'preview', delta: content })
      await mkdir(dirname(target), { recursive: true })
      context.signal.throwIfAborted()
      await writeFile(target, content, 'utf8')
      return { output: `${existed ? 'Replaced' : 'Created'} ${file_path}.` }
    }
  })
}

export { createWriteTool }
