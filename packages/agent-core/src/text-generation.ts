import type {
  ChatProvider,
  ChatProviderStreamInput,
  ProviderFinishReason
} from '@mico/ai-providers'

const MAX_STREAM_PARTS = 100_000

interface TextGenerationRequest {
  provider: ChatProvider
  request: ChatProviderStreamInput
  maxOutputChars: number
}

interface TextGenerationExecution {
  controller: AbortController
  settled: Promise<void>
}

/** The model response cannot be accepted as bounded, tool-free text. */
type TextGenerationRejection =
  | 'stream-limit'
  | 'output-limit'
  | 'tools'
  | 'finish'
  | 'incomplete'
  | 'empty'
class TextGenerationRejected extends Error {
  constructor(
    message: string,
    readonly reason: TextGenerationRejection
  ) {
    super(message)
  }
}

/** Owns bounded text requests and their actual provider lifetime, including acquisition. */
class TextGeneration {
  readonly #executions = new Set<TextGenerationExecution>()
  #isDisposed = false

  async generate({ provider, request, maxOutputChars }: TextGenerationRequest): Promise<string> {
    if (this.#isDisposed)
      throw new Error('Text generation has been disposed. New requests cannot start.')
    const controller = new AbortController()
    const abort = (): void => controller.abort(request.signal.reason)
    request.signal.addEventListener('abort', abort, { once: true })
    if (request.signal.aborted) abort()
    let settle = (): void => {}
    const settled = new Promise<void>((resolve) => {
      settle = resolve
    })
    const execution = { controller, settled }
    // Register before invoking the provider, which may synchronously initiate shutdown.
    this.#executions.add(execution)
    try {
      return await this.#generate(
        provider,
        { ...request, signal: controller.signal },
        maxOutputChars
      )
    } finally {
      request.signal.removeEventListener('abort', abort)
      this.#executions.delete(execution)
      settle()
    }
  }

  dispose(): void {
    this.#isDisposed = true
    for (const execution of this.#executions) execution.controller.abort()
  }

  /** Waits for the current executions to settle, even if their providers ignore abort. */
  async drain(): Promise<void> {
    await Promise.all([...this.#executions].map((execution) => execution.settled))
  }

  async #generate(
    provider: ChatProvider,
    request: ChatProviderStreamInput,
    maxOutputChars: number
  ): Promise<string> {
    const { signal } = request
    signal.throwIfAborted()
    const stream = await provider.stream(request)
    if (signal.aborted) {
      await stream[Symbol.asyncIterator]().return?.()
      signal.throwIfAborted()
    }
    let text = ''
    let finishReason: ProviderFinishReason | null = null
    let partCount = 0
    let deltaChars = 0
    for await (const part of stream) {
      signal.throwIfAborted()
      partCount += 1
      if (partCount > MAX_STREAM_PARTS)
        throw new TextGenerationRejected(
          'The generated text stream exceeded its resource limit. Try again.',
          'stream-limit'
        )
      if (part.type === 'text-delta' || part.type === 'reasoning-delta') {
        deltaChars += part.delta.length
        if (deltaChars > maxOutputChars)
          throw new TextGenerationRejected(
            `The generated text exceeded the maximum length of ${maxOutputChars} characters. Try again.`,
            'output-limit'
          )
      }
      if (part.type === 'text-delta') text += part.delta
      else if (part.type.startsWith('tool-'))
        throw new TextGenerationRejected(
          'The model tried to run tools instead of writing text. Try again.',
          'tools'
        )
      else if (part.type === 'provider-finish') {
        if (part.reason === 'tool-calls')
          throw new TextGenerationRejected(
            'The model tried to run tools instead of writing text. Try again.',
            'tools'
          )
        if (part.reason !== 'stop')
          throw new TextGenerationRejected(
            `The model stopped generating text early (${part.reason}). Try again.`,
            'finish'
          )
        finishReason = part.reason
      }
    }
    signal.throwIfAborted()
    if (finishReason === null)
      throw new TextGenerationRejected(
        'The generated text stream ended without completing. Try again.',
        'incomplete'
      )
    const generated = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim()
    if (!generated)
      throw new TextGenerationRejected('The model returned empty text. Try again.', 'empty')
    return generated
  }
}

export { TextGeneration, TextGenerationRejected }
