import { describe, expect, it } from 'vitest'

import type { ToolPermissionData } from '@shared/ai/permissions'
import { PermissionRequests } from './permission-requests'

const request = {
  ownerId: 'owner-1',
  sessionId: 'session-1',
  requestId: 'turn-1',
  toolCallId: 'tool-1',
  toolName: 'Bash',
  input: { command: 'echo hello' },
  cwd: '/workspace',
  reason: 'Review this command.'
}

describe('permission requests', () => {
  it('user answers from another window when approval is pending, then the operation remains suspended', async () => {
    const requests = new PermissionRequests()
    const events: ToolPermissionData[] = []
    const result = requests.request(request, new AbortController().signal, (event) =>
      events.push(event)
    )
    expect(() =>
      requests.respond('owner-2', { approvalId: events[0].approvalId, decision: 'allow' })
    ).toThrow('not pending')
    requests.respond('owner-1', { approvalId: events[0].approvalId, decision: 'deny' })
    expect(await result).toBe(false)
    expect(events.map(({ state }) => state)).toEqual(['pending', 'denied'])
  })

  it('user answers twice when approval has settled, then the second decision is rejected', async () => {
    const requests = new PermissionRequests()
    const events: ToolPermissionData[] = []
    const result = requests.request(request, new AbortController().signal, (event) =>
      events.push(event)
    )
    const response = { approvalId: events[0].approvalId, decision: 'allow' as const }
    requests.respond('owner-1', response)
    expect(await result).toBe(true)
    expect(() => requests.respond('owner-1', response)).toThrow('not pending')
  })

  it('user stops a turn when approval is pending, then old approval cannot execute it', async () => {
    const requests = new PermissionRequests()
    const controller = new AbortController()
    const events: ToolPermissionData[] = []
    const result = requests.request(request, controller.signal, (event) => events.push(event))
    controller.abort(new Error('Turn cancelled'))
    await expect(result).rejects.toThrow('Turn cancelled')
    expect(events.map(({ state }) => state)).toEqual(['pending', 'cancelled'])
    expect(() =>
      requests.respond('owner-1', { approvalId: events[0].approvalId, decision: 'allow' })
    ).toThrow('not pending')
  })
})
