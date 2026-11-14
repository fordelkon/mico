import type { MemoryContext } from '../memory'
import type { SkillSnapshot } from '../skills'
import { createBashTool } from './bash-tool'
import { registerTool, type RegisteredAgentTool } from './contract'
import { createEditTool } from './edit-tool'
import { createMemoryTools } from './memory-tools'
import { createReadTool } from './read-tool'
import { ToolRegistry, type ToolRegistryOptions } from './registry'
import { createGlobTool, createGrepTool } from './search-tool'
import { createLoadSkillTool, createReadSkillResourceTool } from './skill-tools'
import { createWriteTool } from './write-tool'

type WorkspaceToolOptions = ToolRegistryOptions & {
  skills?: SkillSnapshot
  authorizedSkillIds?: readonly string[]
  memory?: MemoryContext
}

/** Composes capabilities; the registry only owns authorization and execution. */
function createWorkspaceTools(
  cwd: string | null,
  options: WorkspaceToolOptions = {}
): ToolRegistry {
  const tools: RegisteredAgentTool[] = cwd
    ? [
        registerTool(createReadTool()),
        registerTool(createGlobTool()),
        registerTool(createGrepTool()),
        registerTool(createEditTool()),
        registerTool(createWriteTool()),
        registerTool(createBashTool())
      ]
    : []
  if (options.skills) {
    tools.push(
      registerTool(createLoadSkillTool(options.skills, options.authorizedSkillIds)),
      registerTool(createReadSkillResourceTool(options.skills, options.authorizedSkillIds))
    )
  }
  if (options.memory) {
    const [search, remember, forget] = createMemoryTools(options.memory)
    tools.push(registerTool(search), registerTool(remember), registerTool(forget))
  }
  return new ToolRegistry(cwd ?? '(no project workspace)', tools, options)
}

export { createWorkspaceTools }
export type { WorkspaceToolOptions }
