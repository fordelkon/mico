import type { ChatProviderMessage, ChatProviderTool } from '@mico/ai-providers'
import type { ChatMessage } from '@shared/data/schemas/chat'
import { loadProjectInstructions } from '../context/project-instructions'
import type { TurnRunHandle } from '../sessions/session-runtime-service'
import { createSkillSnapshot, type SkillSnapshot } from '../skills'
import { createProjectAgentInstructions } from '../tools/project-agent-instructions'
import { toProviderContext } from './conversation-context'
import { SkillInvocationError } from './turn-failure'

type PreparedTurnContext = {
  cwd: string | null
  skills: SkillSnapshot | undefined
  authorizedSkillIds: readonly string[]
  history: ChatProviderMessage[]
  messages: (
    history: readonly ChatProviderMessage[],
    tools?: readonly ChatProviderTool[]
  ) => ChatProviderMessage[]
}

/** Prepares source lifetimes once, so automatic retries share accepted context. */
async function prepareTurnContext(
  userMessage: ChatMessage,
  handle: TurnRunHandle | null,
  signal?: AbortSignal
): Promise<PreparedTurnContext> {
  const cwd = handle?.cwd ?? null
  const skills = cwd ? await createSkillSnapshot(cwd) : undefined
  const invocation = userMessage.parts.find((part) => part.type === 'data-skill-invocation')
  const accepted = handle?.contextMessages
  const body =
    invocation && accepted === undefined ? await loadInvocation(skills, invocation.data) : null
  if (invocation && !skills)
    throw new SkillInvocationError(
      'Cannot invoke this skill without a project workspace. Open a project and select the skill again.'
    )
  const contextMessages =
    body && invocation
      ? [
          {
            role: 'user' as const,
            parts: [
              {
                type: 'text' as const,
                text: `The user explicitly invoked this skill. Its complete instructions are already loaded; do not call LoadSkill again. Apply them within the user request and their scope.\nSkill arguments: ${invocation.data.arguments}\n\n${body}`
              }
            ]
          }
        ]
      : []
  const projectInstructions = cwd ? await loadProjectInstructions(cwd) : null
  signal?.throwIfAborted()
  if (handle && accepted === undefined) handle.recordContext(contextMessages)
  const replay = handle?.replayMessages ?? [toProviderContext(userMessage)]
  return {
    cwd,
    skills,
    authorizedSkillIds: invocation ? [invocation.data.skillId] : [],
    history: [...replay, ...contextMessages],
    messages: (history, tools) => {
      const system = cwd ? createProjectAgentInstructions(cwd, tools, skills) : null
      return [
        ...(system ? [textMessage('system', system)] : []),
        ...history,
        // Fresh guidance stays ephemeral; accepted skill content already lives in replay.
        ...(projectInstructions
          ? [
              textMessage(
                'user',
                `Context for the current user request; does not replace that request.\n\n${projectInstructions}`
              )
            ]
          : [])
      ]
    }
  }
}

async function loadInvocation(
  skills: SkillSnapshot | undefined,
  invocation: { skillId: string; name: string }
): Promise<string> {
  if (!skills)
    throw new SkillInvocationError(
      'Cannot invoke this skill without a project workspace. Open a project and select the skill again.'
    )
  try {
    const body = await skills.loadForUser(invocation.skillId)
    if (skills.skills.find(({ id }) => id === invocation.skillId)?.name !== invocation.name)
      throw new Error(
        'The selected skill identity changed. Refresh the catalog and select it again.'
      )
    return body
  } catch (error) {
    throw new SkillInvocationError(
      error instanceof Error
        ? error.message
        : 'Cannot load the selected skill. Refresh the skill catalog and try again.'
    )
  }
}

function textMessage(role: 'system' | 'user', text: string): ChatProviderMessage {
  return { role, parts: [{ type: 'text', text }] }
}

export { prepareTurnContext }
