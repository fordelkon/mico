import type { ChatMessage, ChatStartRequest, ChatStreamEvent } from '@shared/data/schemas/chat'
import type { UIMessageChunk } from 'ai'

type ChatStreamFactory = (
  messages: ChatMessage[],
  signal: AbortSignal
) => AsyncIterable<UIMessageChunk>

type ChatRun = {
  controller: AbortController
  ownerId: string
}

class ChatService {
  private readonly runs = new Map<string, ChatRun>()

  constructor(private readonly createStream: ChatStreamFactory) {}

  start(
    { ownerId, request }: { ownerId: string; request: ChatStartRequest },
    emit: (event: ChatStreamEvent) => void
  ): void {
    this.abort({ ownerId, requestId: request.requestId })

    const key = this.getRunKey(ownerId, request.requestId)
    const run = { controller: new AbortController(), ownerId }
    this.runs.set(key, run)
    void this.consume({ key, request, run, emit })
  }

  abort({ ownerId, requestId }: { ownerId: string; requestId: string }): void {
    this.runs.get(this.getRunKey(ownerId, requestId))?.controller.abort()
  }

  abortAll(ownerId: string): void {
    for (const run of this.runs.values()) {
      if (run.ownerId === ownerId) run.controller.abort()
    }
  }

  dispose(): void {
    for (const run of this.runs.values()) {
      run.controller.abort()
    }
  }

  private async consume({
    key,
    request,
    run,
    emit
  }: {
    key: string
    request: ChatStartRequest
    run: ChatRun
    emit: (event: ChatStreamEvent) => void
  }): Promise<void> {
    try {
      for await (const chunk of this.createStream(request.messages, run.controller.signal)) {
        if (!run.controller.signal.aborted) {
          emit({ type: 'chunk', requestId: request.requestId, chunk })
        }
      }

      if (!run.controller.signal.aborted) {
        emit({ type: 'finish', requestId: request.requestId })
      }
    } catch {
      if (!run.controller.signal.aborted) {
        emit({
          type: 'error',
          requestId: request.requestId,
          message: 'Unable to get a response from the chat provider'
        })
      }
    } finally {
      if (this.runs.get(key) === run) this.runs.delete(key)
    }
  }

  private getRunKey(ownerId: string, requestId: string): string {
    return `${ownerId.length}:${ownerId}${requestId}`
  }
}

export { ChatService, type ChatStreamFactory }
