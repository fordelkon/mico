import { createUIMessageStream, type ChatTransport, type UIMessageChunk } from 'ai'

import type { MicoUIMessage } from './chat-types'

const SIMULATED_RESPONSE_TEXT =
  'Mico is ready. This response is generated locally through the same streaming interface a production model transport can use.'

function createAbortError(): DOMException {
  return new DOMException('The chat response was stopped.', 'AbortError')
}

function waitForDelay(delayMs: number, abortSignal?: AbortSignal): Promise<void> {
  if (abortSignal?.aborted) {
    return Promise.reject(createAbortError())
  }

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      abortSignal?.removeEventListener('abort', handleAbort)
      resolve()
    }, delayMs)

    function handleAbort(): void {
      window.clearTimeout(timeoutId)
      abortSignal?.removeEventListener('abort', handleAbort)
      reject(createAbortError())
    }

    abortSignal?.addEventListener('abort', handleAbort, { once: true })
  })
}

type SimulatedChatTransportOptions = {
  delayMs?: number
  responseText?: string
}

class SimulatedChatTransport implements ChatTransport<MicoUIMessage> {
  readonly #delayMs: number
  readonly #responseText: string

  constructor({
    delayMs = 20,
    responseText = SIMULATED_RESPONSE_TEXT
  }: SimulatedChatTransportOptions = {}) {
    this.#delayMs = delayMs
    this.#responseText = responseText
  }

  async sendMessages(
    options: Parameters<ChatTransport<MicoUIMessage>['sendMessages']>[0]
  ): Promise<ReadableStream<UIMessageChunk>> {
    const textPartId = crypto.randomUUID()
    const tokens = this.#responseText.match(/\S+\s*/g) ?? [this.#responseText]

    return createUIMessageStream<MicoUIMessage>({
      execute: async ({ writer }) => {
        writer.write({
          type: 'start',
          messageMetadata: { completionState: 'streaming' }
        })
        writer.write({ type: 'text-start', id: textPartId })

        for (const delta of tokens) {
          await waitForDelay(this.#delayMs, options.abortSignal)
          writer.write({ type: 'text-delta', id: textPartId, delta })
        }

        writer.write({ type: 'text-end', id: textPartId })
        writer.write({
          type: 'finish',
          messageMetadata: { completionState: 'complete' }
        })
      }
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }
}

export { SIMULATED_RESPONSE_TEXT, SimulatedChatTransport, type SimulatedChatTransportOptions }
