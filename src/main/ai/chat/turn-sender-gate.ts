import type { IpcMainInvokeEvent } from 'electron'

import { IpcChannel } from '@shared/IpcChannel'
import type { TurnStreamEvent } from '@shared/ipc/schemas/chat'

type SessionTitleUpdate = { sessionId: string; title: string }
type TurnSenderConnection = {
  emitTurnEvent: (turnEvent: TurnStreamEvent) => void
  emitTitleUpdate: (titleUpdate: SessionTitleUpdate) => void
}

/**
 * Track the renderer senders of chat turns and tie event delivery to their
 * liveness: a disposed sender aborts all of its turns, and a send that fails
 * because its frame died mid-turn does the same.
 */
class TurnSenderGate {
  private readonly destroyedSenderIds = new Set<number>()

  connect(
    event: IpcMainInvokeEvent,
    abortAllTurns: (ownerId: string) => void
  ): TurnSenderConnection {
    const ownerId = String(event.sender.id)
    const senderFrame = event.senderFrame
    if (!this.destroyedSenderIds.has(event.sender.id)) {
      this.destroyedSenderIds.add(event.sender.id)
      event.sender.once('destroyed', () => {
        this.destroyedSenderIds.delete(event.sender.id)
        abortAllTurns(ownerId)
      })
    }

    return {
      emitTurnEvent: (turnEvent) => {
        // A renderer crash can dispose its frame before the owning WebContents emits 'destroyed'.
        if (!senderFrame || event.sender.isDestroyed() || senderFrame.isDestroyed()) {
          abortAllTurns(ownerId)
          return
        }

        try {
          event.sender.send(IpcChannel.Chat_TurnEvent, turnEvent)
        } catch {
          abortAllTurns(ownerId)
        }
      },
      emitTitleUpdate: (titleUpdate) => {
        if (!senderFrame || event.sender.isDestroyed() || senderFrame.isDestroyed()) return

        try {
          event.sender.send(IpcChannel.Sessions_TitleUpdated, titleUpdate)
        } catch {
          // A title update is auxiliary metadata; a failed delivery must not stop the chat.
        }
      }
    }
  }
}

export { TurnSenderGate }
