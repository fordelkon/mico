import { toTurnFailure } from './turn-failure'

type ChatErrorDescription = {
  message: string
  retryable: boolean
}

/**
 * Adapter over the shared turn-failure classification for callers that only
 * need the user-facing message and retry decision.
 */
function describeChatError(error: Error): ChatErrorDescription {
  const { failure, retryable } = toTurnFailure(error)
  return { message: failure.message, retryable }
}

export { describeChatError, type ChatErrorDescription }
