import { useChat, type Chat } from '@ai-sdk/react'
import * as React from 'react'

import type { MicoUIMessage } from '@renderer/types/chat'
import type { ToolPermissionData } from '@shared/ai/permissions'
import { ToolPermissionCard } from '../conversation/tools/tool-permission-card'

/** Pending decisions belong to the active turn's composer, outside the transcript scroll area. */
function ChatApproval({
  chat,
  isActive
}: {
  chat: Chat<MicoUIMessage>
  isActive: boolean
}): React.JSX.Element | null {
  const { messages } = useChat<MicoUIMessage>({ chat })
  const message = messages.at(-1)
  if (
    !isActive ||
    message?.role !== 'assistant' ||
    message.metadata?.completionState === 'complete' ||
    message.metadata?.completionState === 'stopped'
  )
    return null

  // The stream normally replaces data parts by approval ID. Also honor the
  // latest decision if reconnecting delivers more than one part for that ID.
  const permissions = new Map<string, ToolPermissionData>()
  for (const part of message.parts) {
    if (part.type === 'data-tool-permission') permissions.set(part.data.approvalId, part.data)
  }
  const pending = [...permissions.values()].find(
    (permission) =>
      permission.state === 'pending' &&
      message.parts.some(
        (part) =>
          part.type === 'dynamic-tool' &&
          part.toolCallId === permission.toolCallId &&
          (part.state === 'input-available' || part.state === 'input-streaming')
      )
  )
  if (!pending) return null

  return (
    <section aria-label="Pending tool approval" className="mb-2" role="group">
      <ToolPermissionCard
        key={pending.approvalId}
        permission={pending}
        isActive
        onRespond={(response) => window.api.chat.respondToPermission(response)}
      />
    </section>
  )
}

export { ChatApproval }
