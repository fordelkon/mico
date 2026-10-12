import { randomUUID } from 'node:crypto'

import type { PermissionResponse, ToolPermissionData } from '@shared/ai/permissions'
import type { ToolApprovalRequest } from '../workspace'

type PendingPermission = {
  ownerId: string
  settle: (state: 'approved' | 'denied' | 'cancelled') => void
}

/** Pending approvals are process-local and never replayed from persisted transcripts. */
class PermissionRequests {
  readonly #pending = new Map<string, PendingPermission>()

  request(
    request: ToolApprovalRequest & { ownerId: string; sessionId: string; requestId: string },
    signal: AbortSignal,
    emit: (data: ToolPermissionData) => void
  ): Promise<boolean> {
    signal.throwIfAborted()
    const data: ToolPermissionData = {
      approvalId: randomUUID(),
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      input: structuredClone(request.input),
      cwd: request.cwd,
      reason: request.reason,
      state: 'pending'
    }
    return new Promise((resolve, reject) => {
      const abort = (): void => settle('cancelled')
      const settle = (state: 'approved' | 'denied' | 'cancelled'): void => {
        if (!this.#pending.delete(data.approvalId)) return
        signal.removeEventListener('abort', abort)
        try {
          emit({ ...data, state })
        } catch {
          reject(
            new Error('Could not deliver the approval decision. The operation was not executed.')
          )
          return
        }
        if (state === 'cancelled') reject(signal.reason)
        else resolve(state === 'approved')
      }
      this.#pending.set(data.approvalId, { ownerId: request.ownerId, settle })
      signal.addEventListener('abort', abort, { once: true })
      try {
        emit(data)
      } catch {
        this.#pending.delete(data.approvalId)
        signal.removeEventListener('abort', abort)
        reject(new Error('Could not request tool approval. The operation was not executed.'))
      }
      if (signal.aborted) abort()
    })
  }

  respond(ownerId: string, response: PermissionResponse): void {
    const pending = this.#pending.get(response.approvalId)
    if (!pending || pending.ownerId !== ownerId)
      throw new Error(
        'This tool approval is not pending for this window. Return to the active conversation and review its current request.'
      )
    pending.settle(response.decision === 'allow' ? 'approved' : 'denied')
  }
}

export { PermissionRequests }
