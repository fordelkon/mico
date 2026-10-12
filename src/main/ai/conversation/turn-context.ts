import type { ChatProviderMessage } from '@mico/ai-providers'
import type { ChatMessage } from '@shared/data/schemas/chat'
import { Workspaces, type WorkspaceTurnOptions, type WorkspaceTurn } from '../workspace'
import type { TurnRunHandle } from './runtime'
import { toProviderContext } from './provider-messages'
import { SkillInvocationError } from './turn-failure'

type EnterTurn = (cwd: string, options: WorkspaceTurnOptions) => Promise<WorkspaceTurn>
type PreparedTurnContext = {
  registry: WorkspaceTurn['registry'] | undefined
  history: ChatProviderMessage[]
  messages: (history: readonly ChatProviderMessage[]) => ChatProviderMessage[]
}

/** Prepares source lifetimes once, so automatic retries share accepted context. */
async function prepareTurnContext(
  userMessage: ChatMessage,
  handle: TurnRunHandle | null,
  options: Omit<WorkspaceTurnOptions, 'authorizedSkillIds'>,
  signal: AbortSignal,
  enterTurn: EnterTurn = Workspaces.enterTurn
): Promise<PreparedTurnContext> {
  const cwd = handle?.cwd ?? null
  const invocation = userMessage.parts.find((part) => part.type === 'data-skill-invocation')
  const accepted = handle?.contextMessages
  const workspace = cwd
    ? await enterTurn(cwd, {
        ...options,
        authorizedSkillIds: invocation ? [invocation.data.skillId] : []
      })
    : undefined
  if (invocation && !workspace)
    throw new SkillInvocationError(
      'Cannot invoke this skill without a project workspace. Open a project and select the skill again.'
    )
  let contextMessages: NonNullable<TurnRunHandle['contextMessages']> = []
  if (invocation && workspace && accepted === undefined) {
    let body: string
    try {
      body = await workspace.loadInvokedSkill(invocation.data.skillId, invocation.data.name)
    } catch (error) {
      throw new SkillInvocationError(
        error instanceof Error
          ? error.message
          : 'Cannot load the selected skill. Refresh the skill catalog and try again.'
      )
    }
    contextMessages = [
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            text: `The user explicitly invoked this skill. Its complete instructions are already loaded; do not call LoadSkill again. Apply them within the user request and their scope.\nSkill arguments: ${invocation.data.arguments}\n\n${body}`
          }
        ]
      }
    ]
  }
  signal.throwIfAborted()
  if (handle && accepted === undefined) handle.recordContext(contextMessages)
  const replay = handle?.replayMessages ?? [toProviderContext(userMessage)]
  return {
    registry: workspace?.registry,
    history: [...replay, ...contextMessages],
    messages: (history) => {
      const system = workspace?.systemInstructions()
      return [
        ...(system ? [textMessage('system', system)] : []),
        ...history,
        // Fresh guidance stays ephemeral; accepted skill content already lives in replay.
        ...(workspace?.projectInstructions
          ? [
              textMessage(
                'user',
                `Context for the current user request; does not replace that request.\n\n${workspace.projectInstructions}`
              )
            ]
          : [])
      ]
    }
  }
}

function textMessage(role: 'system' | 'user', text: string): ChatProviderMessage {
  return { role, parts: [{ type: 'text', text }] }
}

export { prepareTurnContext }
export type { EnterTurn }
