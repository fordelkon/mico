import type { ChatProvider, ChatProviderStreamInput, ProviderStreamPart } from '@mico/ai-providers'
import { ProviderError } from '@mico/ai-providers'
import { APICallError } from '@ai-sdk/provider'

interface RetryEvent {
  attempt: number
  maxAttempts: number
  retryDelayMs: number
}
interface RetryOptions {
  maxAttempts: number
  retryDelayMs: number
  onRetry?: (event: RetryEvent) => void
}
const MAX_BACKOFF_MS = 30_000
const MAX_PROVIDER_WAIT_MS = 120_000

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  if (!delayMs) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const aborted = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', aborted)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', aborted)
      resolve()
    }, delayMs)
    signal.addEventListener('abort', aborted, { once: true })
  })
}

/** Retries only the current untouched model request, with one shared turn budget. */
class ModelStepRetry {
  private retries = 0
  constructor(private readonly options: RetryOptions) {}

  async *stream(
    provider: ChatProvider,
    request: ChatProviderStreamInput
  ): AsyncIterable<ProviderStreamPart> {
    const { maxAttempts, retryDelayMs, onRetry } = this.options
    for (let attempt = 1; ; attempt += 1) {
      request.signal.throwIfAborted()
      let observed = false
      try {
        const stream = await provider.stream(request)
        request.signal.throwIfAborted()
        for await (const chunk of stream) {
          request.signal.throwIfAborted()
          observed = true
          yield chunk
        }
        return
      } catch (error) {
        request.signal.throwIfAborted()
        if (
          observed ||
          this.retries >= maxAttempts - 1 ||
          !(error instanceof Error) ||
          !isRetryableProviderError(error)
        )
          throw error
        const backoff = Math.min(MAX_BACKOFF_MS, retryDelayMs * 2 ** (attempt - 1))
        const providerDelay =
          error instanceof ProviderError
            ? Math.max(
                0,
                error.retryAt !== undefined ? error.retryAt - Date.now() : (error.retryAfterMs ?? 0)
              )
            : 0
        if (providerDelay > MAX_PROVIDER_WAIT_MS) throw error
        const delay = Math.max(providerDelay, Math.floor(backoff * (0.8 + Math.random() * 0.2)))
        this.retries += 1
        onRetry?.({ attempt: attempt + 1, maxAttempts, retryDelayMs: delay })
        await wait(delay, request.signal)
      }
    }
  }
}

function isRetryableProviderError(error: Error): boolean {
  if (error instanceof ProviderError) {
    return (
      error.kind === 'transport' ||
      error.kind === 'incomplete_stream' ||
      error.kind === 'rate_limit' ||
      (error.kind === 'http' &&
        error.status !== undefined &&
        (error.status === 408 || error.status >= 500))
    )
  }
  if (error instanceof TypeError) return true
  return (
    APICallError.isInstance(error) &&
    error.statusCode !== 401 &&
    error.statusCode !== 403 &&
    error.statusCode !== 404 &&
    error.isRetryable
  )
}

export { ModelStepRetry, type RetryEvent }
