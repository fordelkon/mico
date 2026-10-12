import { parseDocument } from 'yaml'
import { z } from 'zod'

// Compatibility with agents that allow dots, underscores, and leading digits in
// skill names; the pattern still bounds the name to 1-64 lowercase characters.
const skillNamePattern = /^[a-z0-9][a-z0-9._-]{0,63}$/

const skillMetadataSchema = z.object({
  name: z.string().min(1).max(64).regex(skillNamePattern),
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

function derivedDescription(body: string): string {
  const line = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!line) return 'No description provided.'
  if (line.length <= 1024) return line
  // Truncate within the UTF-16 length cap without splitting a surrogate pair.
  const end = line.charCodeAt(1023) >= 0xd800 && line.charCodeAt(1023) <= 0xdbff ? 1023 : 1024
  return line.slice(0, end)
}

function parseSkillDocument(text: string, fallbackName: string): ParsedSkillDocument {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!match) {
    // A document that opens with the delimiter but never closes it is a broken
    // frontmatter attempt, not a frontmatter-less document; deriving metadata
    // from it would feed the raw YAML to the model as instructions.
    if (/^---\r?\n/.test(text))
      throw new Error('SKILL.md frontmatter is missing its closing --- delimiter.')
    // Documents without frontmatter stay discoverable through derived metadata;
    // documents with frontmatter keep the strict parsing below.
    const derived = skillMetadataSchema.safeParse({
      name: fallbackName,
      description: derivedDescription(text)
    })
    if (!derived.success) throw new Error(`Invalid skill metadata: ${derived.error.message}`)
    return {
      name: derived.data.name,
      description: derived.data.description,
      disableModelInvocation: false,
      userInvocable: true,
      body: text,
      warnings: [
        'SKILL.md has no YAML frontmatter; metadata was derived from the directory name and document body.'
      ]
    }
  }
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
