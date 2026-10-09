import * as z from 'zod'

import type { SkillSnapshot } from '../skills'
import { type AgentTool, defineAgentTool } from './tool-contract'

const SkillInputSchema = z.strictObject({
  skill_id: z.string().min(1).max(512).describe('Registered skill ID or exact skill name.')
})
const ResourceInputSchema = SkillInputSchema.extend({
  relative_path: z
    .string()
    .min(1)
    .max(4096)
    .describe('Resource path relative to the loaded skill base directory.')
})
type SkillInput = z.infer<typeof SkillInputSchema>
type ResourceInput = z.infer<typeof ResourceInputSchema>

function assertModelAccess(
  snapshot: SkillSnapshot,
  idOrName: string,
  authorizedIds: readonly string[]
): void {
  const skill = snapshot.skills.find(({ id, name }) => id === idOrName || name === idOrName)
  if (skill?.disableModelInvocation && !authorizedIds.includes(skill.id)) {
    throw new Error(`Skill "${skill.name}" requires an explicit user invocation in this turn.`)
  }
}

function createLoadSkillTool(
  snapshot: SkillSnapshot,
  authorizedIds: readonly string[] = []
): AgentTool<SkillInput> {
  return defineAgentTool({
    name: 'LoadSkill',
    description:
      'Load registered skill instructions by ID or exact name. Read the complete instructions before applying the skill.',
    inputSchema: SkillInputSchema,
    isConcurrencySafe: () => true,
    operation: () => ({ kind: 'read-only' }),
    async execute({ skill_id }, context) {
      context.signal.throwIfAborted()
      assertModelAccess(snapshot, skill_id, authorizedIds)
      return { output: await snapshot.load(skill_id) }
    }
  })
}

function createReadSkillResourceTool(
  snapshot: SkillSnapshot,
  authorizedIds: readonly string[] = []
): AgentTool<ResourceInput> {
  return defineAgentTool({
    name: 'ReadSkillResource',
    description:
      'Read a UTF-8 reference inside a registered skill directory using its ID or exact name and a relative path. This tool cannot run scripts or read outside that skill.',
    inputSchema: ResourceInputSchema,
    isConcurrencySafe: () => true,
    operation: () => ({ kind: 'read-only' }),
    async execute({ skill_id, relative_path }, context) {
      context.signal.throwIfAborted()
      assertModelAccess(snapshot, skill_id, authorizedIds)
      return { output: await snapshot.readResource(skill_id, relative_path) }
    }
  })
}

export { createLoadSkillTool, createReadSkillResourceTool }
