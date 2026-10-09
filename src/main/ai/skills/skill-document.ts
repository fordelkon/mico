import { parseDocument } from 'yaml'
import { z } from 'zod'

const skillMetadataSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().min(1).max(1024),
  'disable-model-invocation': z.boolean().optional().default(false),
  'user-invocable': z.boolean().optional().default(true)
})

interface ParsedSkillDocument {
  name: string
  description: string
  disableModelInvocation: boolean
  userInvocable: boolean
  body: string
  warnings: readonly string[]
}

function parseSkillDocument(text: string): ParsedSkillDocument {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!match) throw new Error('SKILL.md requires YAML frontmatter between --- delimiters.')
  const document = parseDocument(match[1], { schema: 'core', uniqueKeys: true })
  const problem = document.errors[0] ?? document.warnings[0]
  if (problem) throw new Error(`Invalid skill YAML: ${problem.message}`)
  const metadata: unknown = document.toJS({ maxAliasCount: 0 })
  const parsed = skillMetadataSchema.safeParse(metadata)
  if (!parsed.success) throw new Error(`Invalid skill metadata: ${parsed.error.message}`)
  const unsupported = ['context', 'agent', 'allowed-tools', 'hooks', 'model', 'effort']
  const warnings = unsupported
    .filter((key) => document.has(key))
    .map(
      (key) =>
        `Skill field "${key}" is unsupported; this service only loads instructions and reads resources.`
    )
  return {
    name: parsed.data.name,
    description: parsed.data.description,
    disableModelInvocation: parsed.data['disable-model-invocation'],
    userInvocable: parsed.data['user-invocable'],
    body: text.slice(match[0].length),
    warnings
  }
}

export { parseSkillDocument }
