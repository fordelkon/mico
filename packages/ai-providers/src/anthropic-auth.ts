type AnthropicAuthentication = 'api-key' | 'bearer'

function createAnthropicHeaders(
  apiKey: string | undefined,
  customHeaders: Record<string, string> | undefined,
  authentication: AnthropicAuthentication = 'api-key'
): Headers {
  const headers = new Headers({ 'anthropic-version': '2023-06-01', ...customHeaders })
  if (!apiKey) return headers

  if (authentication === 'bearer') {
    headers.delete('x-api-key')
    if (!headers.has('authorization')) headers.set('authorization', `Bearer ${apiKey}`)
  } else if (!headers.has('x-api-key')) {
    headers.set('x-api-key', apiKey)
  }

  return headers
}

export { createAnthropicHeaders }
