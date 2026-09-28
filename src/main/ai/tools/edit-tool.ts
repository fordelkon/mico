import { readFile, writeFile } from 'node:fs/promises'

import * as z from 'zod'

import {
  defineAgentTool,
  emitToolOutputDelta,
  MAX_EDIT_REPLACEMENTS,
  type AgentTool
} from './tool-contract'
import { resolveWorkspacePath } from './workspace-path-policy'

const EditInputSchema = z.strictObject({
  path: z
    .string()
    .min(1)
    .max(4_096)
    .refine((value) => !value.includes('\0')),
  edits: z
    .array(z.strictObject({ oldText: z.string().min(1), newText: z.string() }))
    .min(1)
    .max(MAX_EDIT_REPLACEMENTS)
})
type EditInput = z.infer<typeof EditInputSchema>
type Replacement = { start: number; end: number; newText: string }

function formatEditPreview(edits: EditInput['edits']): string {
  return edits
    .flatMap(({ oldText, newText }) => [
      ...oldText.split('\n').map((line) => `- ${line}`),
      ...newText.split('\n').map((line) => `+ ${line}`)
    ])
    .join('\n')
}

function findUniqueReplacement(source: string, oldText: string, newText: string): Replacement {
  const start = source.indexOf(oldText)
  if (start < 0 || source.indexOf(oldText, start + 1) >= 0)
    throw new Error('Each edit oldText must match exactly once.')
  return { start, end: start + oldText.length, newText }
}

// No safety annotations: the fail-closed defaults apply (serial, treated as a write).
function createEditTool(): AgentTool<EditInput> {
  return defineAgentTool({
    name: 'edit',
    description: 'Edit one project file using exact, unique text replacements.',
    inputSchema: EditInputSchema,
    async validateInput({ edits }) {
      const noOp = edits.find(({ oldText, newText }) => oldText === newText)
      if (!noOp) return null
      return {
        message:
          'Edit oldText and newText are identical. Re-read the file and provide an actual change.'
      }
    },
    async execute({ path, edits }, context) {
      context.signal.throwIfAborted()
      const target = await resolveWorkspacePath(context.cwd, path)
      const original = await readFile(target, 'utf8')
      const lineEnding = original.includes('\r\n') ? '\r\n' : '\n'
      const normalized = original.replaceAll('\r\n', '\n')
      const replacements = edits.map(({ oldText, newText }) =>
        findUniqueReplacement(normalized, oldText, newText)
      )
      const ordered = replacements.toSorted((left, right) => right.start - left.start)
      for (let index = 1; index < ordered.length; index += 1) {
        if (ordered[index - 1].start < ordered[index].end)
          throw new Error('Edit replacements must not overlap.')
      }
      let next = normalized
      for (const replacement of ordered)
        next = next.slice(0, replacement.start) + replacement.newText + next.slice(replacement.end)
      context.signal.throwIfAborted()
      // Emit only after all exact-match and overlap checks pass, so the preview
      // never depicts a patch that this tool has already rejected.
      emitToolOutputDelta(context, { stream: 'preview', delta: formatEditPreview(edits) })
      await writeFile(target, lineEnding === '\r\n' ? next.replaceAll('\n', '\r\n') : next, 'utf8')
      return { output: `Successfully replaced ${edits.length} block(s) in ${path}.` }
    }
  })
}

export { createEditTool }
