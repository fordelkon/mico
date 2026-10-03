import { readFile, writeFile } from 'node:fs/promises'
import * as z from 'zod'

import { defineAgentTool, emitToolOutputDelta } from './tool-contract'
import { resolveWorkspacePath } from './workspace-path-policy'

const EditInputSchema = z.strictObject({
  file_path: z
    .string()
    .min(1)
    .max(4_096)
    .refine((value) => !value.includes('\0'))
    .describe('Path of the file to edit inside the workspace; prefer an absolute path.'),
  old_string: z
    .string()
    .min(1)
    .describe(
      'Exact text to replace, including whitespace. Must match uniquely unless replace_all is true.'
    ),
  new_string: z
    .string()
    .describe(
      'Replacement text, different from old_string. Use an empty string to delete the matched text.'
    ),
  replace_all: z
    .boolean()
    .optional()
    .describe('Replace every occurrence of old_string. Defaults to false.')
})

function createEditTool() {
  return defineAgentTool({
    name: 'Edit',
    description:
      'Edit an existing workspace file by exact string replacement. Read the file first. Supply file_path, old_string and new_string. Use replace_all only when every occurrence should change. This is not a regex or patch tool; use Write to create a file.',
    inputSchema: EditInputSchema,
    operation: ({ file_path }) => ({ kind: 'file-write', path: file_path, allowMissing: false }),
    async validateInput({ old_string, new_string }) {
      return old_string === new_string
        ? {
            message:
              'Edit old_string and new_string are identical. Re-read the file and provide an actual change.'
          }
        : null
    },
    async execute({ file_path, old_string, new_string, replace_all = false }, context) {
      context.signal.throwIfAborted()
      const target = await resolveWorkspacePath(context.cwd, file_path)
      const original = await readFile(target, 'utf8')
      const lineEnding = original.includes('\r\n') ? '\r\n' : '\n'
      const source = original.replaceAll('\r\n', '\n')
      const before = old_string.replaceAll('\r\n', '\n')
      const after = new_string.replaceAll('\r\n', '\n')
      const matches = source.split(before)
      const count = matches.length - 1
      if (count === 0)
        throw new Error(
          'Edit old_string was not found. Read the file again and copy the exact text to replace.'
        )
      if (!replace_all && source.indexOf(before, source.indexOf(before) + 1) >= 0)
        throw new Error(
          'Edit old_string must match exactly once. Include more surrounding text, or set replace_all=true to change every occurrence.'
        )
      const next = matches.join(after)
      context.signal.throwIfAborted()
      emitToolOutputDelta(context, {
        stream: 'preview',
        delta: [
          ...before.split('\n').map((line) => `- ${line}`),
          ...after.split('\n').map((line) => `+ ${line}`)
        ].join('\n')
      })
      await writeFile(target, lineEnding === '\r\n' ? next.replaceAll('\n', '\r\n') : next, 'utf8')
      return { output: `Successfully replaced ${count} occurrence(s) in ${file_path}.` }
    }
  })
}

export { createEditTool }
