import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ChatAPI } from '@shared/ipc/schemas/chat'
import type { ToolPermissionData } from '@shared/ai/permissions'
import { ToolPermissionCard } from './tool-permission-card'

const permission: ToolPermissionData = {
  approvalId: '00000000-0000-4000-8000-000000000001',
  toolCallId: 'bash-1',
  toolName: 'Bash',
  cwd: '/workspace',
  input: { command: 'echo first\necho second' },
  reason: 'This command runs on your computer without a sandbox.',
  state: 'pending'
}

describe('tool permission card', () => {
  it.each(['Allow once', 'Deny'] as const)(
    'user chooses %s when reviewing a command, then the exact pending approval is answered',
    async (choice) => {
      const user = userEvent.setup()
      const respond = vi.fn<ChatAPI['respondToPermission']>().mockResolvedValue()
      render(<ToolPermissionCard permission={permission} isActive onRespond={respond} />)
      expect(screen.getByLabelText('Command')).toHaveTextContent('echo first echo second')
      expect(screen.getByText('/workspace')).toBeVisible()
      await user.click(screen.getByRole('button', { name: choice }))
      expect(respond).toHaveBeenCalledWith({
        approvalId: permission.approvalId,
        decision: choice === 'Allow once' ? 'allow' : 'deny'
      })
      expect(screen.getByRole('button', { name: 'Allow once' })).toBeDisabled()
    }
  )

  it('user views a stopped approval when the turn is inactive, then no decision controls remain', () => {
    render(
      <ToolPermissionCard
        permission={permission}
        isActive={false}
        onRespond={vi.fn<ChatAPI['respondToPermission']>()}
      />
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Approval cancelled. The operation was not executed.')).toBeVisible()
  })

  it('user encounters an approval error when submitting, then the pending controls remain retryable', async () => {
    const user = userEvent.setup()
    render(
      <ToolPermissionCard
        permission={permission}
        isActive
        onRespond={vi
          .fn<ChatAPI['respondToPermission']>()
          .mockRejectedValue(new Error('Disconnected.'))}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Allow once' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Disconnected.')
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeEnabled()
  })
})
