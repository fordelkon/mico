import * as z from 'zod'
import type { JsonValue } from './contracts'

export type ProviderErrorKind =
  | 'http'
  | 'rate_limit'
  | 'quota'
  | 'context_overflow'
  | 'transport'
  | 'incomplete_stream'
  | 'provider'

export interface ProviderErrorOptions {
  status?: number
  /** Minimum retry delay in milliseconds, measured when the response is received. */
  retryAfterMs?: number
  /** Absolute retry deadline as Unix milliseconds. */
  retryAt?: number
  cause?: unknown
}

const messages = {
  http: 'The provider rejected the request. Check the provider settings and try again.',
  rate_limit: 'The provider rate limit was reached. Wait before trying again.',
  quota:
    'The provider quota is exhausted. Check your account billing or limits before trying again.',
  context_overflow:
    'The request exceeds the provider context limit. Shorten the conversation and try again.',
  transport: 'The connection to the provider failed. Check your connection and try again.',
  incomplete_stream: 'The provider stream ended before completion. Try the request again.',
  provider: 'The provider could not complete the request. Try again or check the provider settings.'
} satisfies Record<ProviderErrorKind, string>

/** Safe failure metadata; raw server bodies, transport messages and causes are never retained. */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind
  readonly status?: number
  readonly retryAfterMs?: number
  readonly retryAt?: number

  constructor(kind: ProviderErrorKind, options: ProviderErrorOptions = {}) {
    // Preserve only the failure category, never an upstream message/stack/body.
    super(
      messages[kind],
      options.cause === undefined
        ? undefined
        : {
            cause: new Error('An upstream provider operation failed.')
          }
    )
    this.name = 'ProviderError'
    this.kind = kind
    this.status = options.status
    this.retryAfterMs = options.retryAfterMs
    this.retryAt = options.retryAt
  }
}

const ErrorDetailsSchema = z.object({
  code: z.string().nullable().optional(),
  type: z.string().optional(),
  message: z.string().optional()
})
const ErrorEnvelopeSchema = z.object({
  error: z.union([z.string(), ErrorDetailsSchema]).optional()
})
const contextCodes = new Set([
  'context_length_exceeded',
  'context_window_exceeded',
  'context_overflow',
  'prompt_too_long',
  'input_too_long',
  'too_many_tokens'
])

type ProviderFailureDetails = z.infer<typeof ErrorDetailsSchema>

// Parse the untrusted error envelope at the boundary; only classification fields survive.
function parseFailure(value: JsonValue | undefined): ProviderFailureDetails | undefined {
  const envelope = ErrorEnvelopeSchema.safeParse(value)
  const error = envelope.success && envelope.data.error !== undefined ? envelope.data.error : value
  const details = ErrorDetailsSchema.safeParse(error)
  if (details.success) return details.data
  const message = z.string().safeParse(error)
  return message.success ? { message: message.data } : undefined
}

function isContextOverflow(details: ProviderFailureDetails | undefined): boolean {
  const code = details?.code ?? details?.type
  if (code && contextCodes.has(code.toLowerCase())) return true
  const message = details?.message
  return Boolean(
    message &&
      (/\b(?:maximum context length|context (?:window|length|limit))\b.{0,80}\b(?:exceed|too long|maximum|limit)/i.test(
        message
      ) ||
        /\b(?:exceed\w*|too long)\b.{0,80}\b(?:context (?:window|length|limit))/i.test(message) ||
        /\bprompt is too long\b/i.test(message) ||
        /\binput (?:tokens?|length)\b.{0,60}\bexceeds?\b.{0,40}\b(?:maximum|limit)/i.test(message))
  )
}

export function providerApiError(value: JsonValue | undefined): ProviderError {
  const details = parseFailure(value)
  return new ProviderError(isContextOverflow(details) ? 'context_overflow' : 'provider')
}

function retryTiming(
  header: string | null
): Pick<ProviderErrorOptions, 'retryAfterMs' | 'retryAt'> {
  if (!header) return {}
  const now = Date.now()
  if (/^\d+$/.test(header.trim())) {
    const retryAfterMs = Number(header) * 1000
    return Number.isSafeInteger(retryAfterMs) && Number.isSafeInteger(now + retryAfterMs)
      ? { retryAfterMs, retryAt: now + retryAfterMs }
      : {}
  }
  // A Retry-After date must be an HTTP date, not a number Date.parse happens to accept.
  if (!/^[A-Za-z]{3},?\s/.test(header)) return {}
  const retryAt = Date.parse(header)
  return Number.isFinite(retryAt) ? { retryAfterMs: Math.max(0, retryAt - now), retryAt } : {}
}

const MAX_ERROR_BYTES = 16_384

const ERROR_BODY_TIMEOUT_MS = 1000

async function readErrorBody(
  response: Response,
  signal?: AbortSignal
): Promise<ProviderFailureDetails | undefined> {
  signal?.throwIfAborted()
  const reader = response.body?.getReader()
  if (!reader) return undefined
  const decoder = new TextDecoder()
  let text = ''
  let size = 0
  let timeout: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const interrupted = new Promise<undefined>((resolve, reject) => {
    timeout = setTimeout(() => resolve(undefined), ERROR_BODY_TIMEOUT_MS)
    onAbort = () => reject(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
  const read = async (): Promise<ProviderFailureDetails | undefined> => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_ERROR_BYTES) return undefined
      text += decoder.decode(value, { stream: true })
    }
    return parseFailure(JSON.parse(text + decoder.decode()))
  }
  try {
    return await Promise.race([read(), interrupted])
  } catch (cause) {
    signal?.throwIfAborted()
    if (cause instanceof Error && cause.name === 'AbortError') throw cause
    return undefined
  } finally {
    clearTimeout(timeout)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
    // A cloned response is a tee; awaiting cancellation may wait for its sibling.
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export async function responseHasContextOverflow(
  response: Response,
  signal?: AbortSignal
): Promise<boolean> {
  return (
    [400, 413, 422].includes(response.status) &&
    isContextOverflow(await readErrorBody(response.clone(), signal))
  )
}

export async function assertProviderResponse(
  response: Response,
  signal?: AbortSignal
): Promise<void> {
  if (!response.ok) {
    const timing = retryTiming(response.headers.get('retry-after'))
    const body = await readErrorBody(response, signal)
    const kind =
      response.status === 429
        ? ['insufficient_quota', 'quota_exceeded', 'billing_hard_limit_reached'].includes(
            body?.code ?? body?.type ?? ''
          )
          ? 'quota'
          : 'rate_limit'
        : [400, 413, 422].includes(response.status) && isContextOverflow(body)
          ? 'context_overflow'
          : 'http'
    throw new ProviderError(kind, { status: response.status, ...timing })
  }
  if (!response.body) throw new ProviderError('incomplete_stream')
}

export function throwNormalizedTransportError(cause: unknown): never {
  if (cause instanceof ProviderError) throw cause
  if (cause instanceof SyntaxError) throw new ProviderError('provider', { cause })
  if (cause instanceof TypeError || (cause instanceof Error && cause.name === 'TimeoutError'))
    throw new ProviderError('transport', { cause })
  throw cause
}

export function safeProviderFetch(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    try {
      return await fetch(input, init)
    } catch (error) {
      throwNormalizedTransportError(error)
    }
  }
}
