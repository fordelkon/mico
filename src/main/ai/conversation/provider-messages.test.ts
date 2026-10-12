import type { ChatMessage } from '@shared/data/schemas/chat'
import { describe, expect, it } from 'vitest'
import { getMessageText, toProviderContext, toProviderReplayContext } from './provider-messages'

describe('skill conversation context', () => {
  it('user sends a skill invocation when context is projected, then only visible request text reaches the provider', () => {
    const message: ChatMessage = {
      role: 'user',
      parts: [
        { type: 'text', text: '/skill:review inspect 文件' },
        {
          type: 'data-skill-invocation',
          data: { skillId: 'project-agents:review', name: 'review', arguments: 'inspect 文件' }
        }
      ]
    }
    const expected = { role: 'user', parts: [{ type: 'text', text: '/skill:review inspect 文件' }] }
    expect(toProviderContext(message)).toEqual(expected)
    expect(toProviderReplayContext(message)).toEqual(expected)
    expect(getMessageText(message)).toBe('/skill:review inspect 文件')
  })
})
