import { APICallError } from 'ai'

type ChatErrorDescription = {
  message: string
  retryable: boolean
}

function describeChatError(error: Error): ChatErrorDescription {
  if (error instanceof TypeError) {
    return {
      message: "Couldn't connect to the API endpoint. Check the API URL, network, VPN, or proxy.",
      retryable: true
    }
  }

  if (!APICallError.isInstance(error)) {
    return { message: "Couldn't generate a response. Please try again.", retryable: false }
  }

  if (error.statusCode === 401 || error.statusCode === 403) {
    return {
      message:
        'Authentication failed for this provider. Check the API key and account permissions.',
      retryable: false
    }
  }

  if (error.statusCode === 404) {
    return {
      message: 'The selected model or API endpoint is unavailable. Check the provider settings.',
      retryable: false
    }
  }

  if (error.statusCode === 429) {
    return {
      message: 'The provider is rate limiting requests. Please try again shortly.',
      retryable: error.isRetryable
    }
  }

  if (error.statusCode !== undefined && error.statusCode >= 500) {
    return {
      message: 'The provider is temporarily unavailable. Please try again shortly.',
      retryable: error.isRetryable
    }
  }

  return {
    message: "Couldn't generate a response. Please try again.",
    retryable: error.isRetryable
  }
}

export { describeChatError, type ChatErrorDescription }
