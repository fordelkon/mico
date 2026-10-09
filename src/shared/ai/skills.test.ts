import { describe, expect, it } from 'vitest'

import { ChatMessageSchema, ChatUserMessageSchema } from '../data/schemas/chat'

const invocation = {
  type: 'data-skill-invocation',
  data: { skillId: 'project-agents:review', name: 'review', arguments: 'Review Unicode 文件 😀' }
}

describe('skill invocation persistence', () => {
  it('user submits a skill when messages round-trip, then identity and arguments remain durable', () => {
    const message = { role: 'user', parts: [invocation] }
    const accepted = ChatUserMessageSchema.parse(message)
    expect(ChatMessageSchema.parse(JSON.parse(JSON.stringify(accepted)))).toEqual(message)
  })

  it('user supplies repeated or assistant invocations when validated, then invalid attribution is rejected', () => {
    expect(
      ChatUserMessageSchema.safeParse({ role: 'user', parts: [invocation, invocation] }).success
    ).toBe(false)
    expect(ChatMessageSchema.safeParse({ role: 'assistant', parts: [invocation] }).success).toBe(
      false
    )
  })

  it.each([
    { ...invocation, data: { ...invocation.data, skillId: '' } },
    { ...invocation, data: { ...invocation.data, name: '../review' } },
    { ...invocation, data: { ...invocation.data, arguments: null } },
    { ...invocation, data: { ...invocation.data, arguments: 'x'.repeat(65537) } },
    { ...invocation, data: { ...invocation.data, path: '/private' } }
  ])('user submits invalid skill data when validated, then the request is rejected', (part) => {
    expect(ChatUserMessageSchema.safeParse({ role: 'user', parts: [part] }).success).toBe(false)
  })
})
