import type { ChatProviderStreamInput, ProviderStreamPart } from '@mico/ai-providers'
import { providerFinish } from '@mico/ai-providers'
import {
  ToolPermissionDataSchema,
  type TurnStartRequest,
  type TurnStreamEvent
} from '@mico/coding-agent/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { Memories } from '../memory'
import { Conversations } from './conversations'
import {
  createModels,
  createRuntime,
  createTemporaryWorkspace,
  isTitleStream,
  removeTemporaryPaths
} from './test-helpers'

async function* answer(): AsyncIterable<ProviderStreamPart> {
  yield { type: 'text-delta', id: 'answer', delta: 'Done.' }
  yield providerFinish({ reason: 'stop' })
}

async function* remember(): AsyncIterable<ProviderStreamPart> {
  yield {
    type: 'tool-input-available',
    toolCallId: 'remember',
    toolName: 'RememberMemory',
    input: {
      scope: 'project',
      key: 'answer-style',
      category: 'feedback',
      summary: 'Prefer concise Chinese answers.',
      content: 'For this project, the user prefers concise Chinese answers.'
    }
  }
  yield providerFinish({ reason: 'tool-calls' })
}

function send(conversations: Conversations, request: TurnStartRequest): Promise<TurnStreamEvent[]> {
  return new Promise((resolve) => {
    const events: TurnStreamEvent[] = []
    conversations.startTurn({ ownerId: 'window', request }, (event) => {
      events.push(event)
      if (event.type === 'chunk' && event.chunk.type === 'data-tool-permission') {
        const permission = ToolPermissionDataSchema.parse(event.chunk.data)
        if (permission.state === 'pending')
          conversations.respondToPermission('window', {
            approvalId: permission.approvalId,
            decision: 'allow'
          })
      }
      if (event.type === 'finish' || event.type === 'error' || event.type === 'cancelled')
        resolve(events)
    })
  })
}

function request(sessionId: string, requestId: string): TurnStartRequest {
  return {
    sessionId,
    requestId,
    userMessage: { role: 'user', parts: [{ type: 'text', text: 'Continue with this project.' }] }
  }
}

function includesPreference(input: ChatProviderStreamInput): boolean {
  return input.messages.some((message) =>
    message.parts.some(
      (part) => part.type === 'text' && part.text.includes('Prefer concise Chinese answers.')
    )
  )
}

describe('Conversation memory', () => {
  afterEach(removeTemporaryPaths)

  it('user saves a preference when starting a chat, then new project chats reuse it until forgotten', async () => {
    const directory = await createTemporaryWorkspace('mico-memory-conversation-')
    const alpha = await createTemporaryWorkspace('mico-memory-alpha-')
    const beta = await createTemporaryWorkspace('mico-memory-beta-')
    const { database } = await createRuntime()
    const inputs: ChatProviderStreamInput[] = []
    let calls = 0
    const models = await createModels(() => ({
      getModelCapabilities: async () => null,
      stream: async (input) => {
        if (isTitleStream(input)) return answer()
        inputs.push(input)
        calls += 1
        return calls === 1 ? remember() : answer()
      }
    }))
    const first = new Conversations({ database, models, memories: new Memories({ directory }) })
    const original = first.createSession({
      title: 'Learning',
      projectId: 'alpha',
      cwd: alpha,
      defaultProfile: null
    })
    const events = await send(first, request(original.id, 'learn'))
    expect(events.at(-1)?.type).toBe('finish')
    expect(
      events.some((event) => event.type === 'chunk' && event.chunk.type === 'data-tool-permission')
    ).toBe(true)
    await first.drain()

    const memories = new Memories({ directory })
    const reopened = new Conversations({ database, models, memories })
    try {
      const sameProject = reopened.createSession({
        title: 'New chat in alpha',
        projectId: 'alpha',
        cwd: alpha,
        defaultProfile: null
      })
      expect((await send(reopened, request(sameProject.id, 'reuse'))).at(-1)?.type).toBe('finish')
      expect(includesPreference(inputs.at(-1)!)).toBe(true)
      expect(reopened.loadSession(sameProject.id).messages[0]?.parts).toEqual([
        { type: 'text', text: 'Continue with this project.' }
      ])

      const otherProject = reopened.createSession({
        title: 'Other project',
        projectId: 'beta',
        cwd: beta,
        defaultProfile: null
      })
      expect((await send(reopened, request(otherProject.id, 'isolated'))).at(-1)?.type).toBe(
        'finish'
      )
      expect(includesPreference(inputs.at(-1)!)).toBe(false)

      await memories
        .openContext({ projectId: 'alpha' })
        .forget({ scope: 'project', key: 'answer-style', expectedRevision: 1 })
      const afterDeletion = reopened.createSession({
        title: 'After deletion',
        projectId: 'alpha',
        cwd: alpha,
        defaultProfile: null
      })
      expect((await send(reopened, request(afterDeletion.id, 'forgotten'))).at(-1)?.type).toBe(
        'finish'
      )
      expect(includesPreference(inputs.at(-1)!)).toBe(false)
    } finally {
      await reopened.drain()
    }
  })
})
