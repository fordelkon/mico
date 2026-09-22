import { describe, expect, it } from 'vitest'

import { createRequestNegotiator } from '../request-negotiator'

type RecordedVariant = {
  includeThinking: boolean
  useFallbackThinking: boolean
  useFallbackAuth: boolean
}

function statusResponse(status: number): Response {
  return new Response(null, { status })
}

function createRecorder(responses: Response[]) {
  const variants: RecordedVariant[] = []
  const attempt = async (variant: RecordedVariant) => {
    variants.push({ ...variant })
    return responses[Math.min(variants.length, responses.length) - 1]
  }
  return { variants, attempt }
}

describe('request negotiator', () => {
  it('user gets a no-thinking retry when the optimistic effort is rejected, then the rejection is remembered', async () => {
    const { variants, attempt } = createRecorder([statusResponse(400), statusResponse(200)])
    const negotiate = createRequestNegotiator({
      supportsFallbackAuth: false,
      supportsFallbackThinking: false
    })

    const first = await negotiate({ thinkingEffort: 'high', attempt })
    const second = await negotiate({ thinkingEffort: 'high', attempt })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(variants).toEqual([
      { includeThinking: true, useFallbackThinking: false, useFallbackAuth: false },
      { includeThinking: false, useFallbackThinking: false, useFallbackAuth: false },
      { includeThinking: false, useFallbackThinking: false, useFallbackAuth: false }
    ])
  })

  it('user gets one bearer retry when authentication is rejected, then fallback auth is remembered', async () => {
    const { variants, attempt } = createRecorder([statusResponse(401), statusResponse(200)])
    const negotiate = createRequestNegotiator({
      supportsFallbackAuth: true,
      supportsFallbackThinking: false
    })

    await negotiate({ thinkingEffort: null, attempt })
    await negotiate({ thinkingEffort: null, attempt })

    expect(variants).toEqual([
      { includeThinking: false, useFallbackThinking: false, useFallbackAuth: false },
      { includeThinking: false, useFallbackThinking: false, useFallbackAuth: true },
      { includeThinking: false, useFallbackThinking: false, useFallbackAuth: true }
    ])
  })

  it('user gets a budget-shape retry when the adaptive shape is rejected, then budget is used directly', async () => {
    const { variants, attempt } = createRecorder([statusResponse(400), statusResponse(200)])
    const negotiate = createRequestNegotiator({
      supportsFallbackAuth: false,
      supportsFallbackThinking: true
    })

    await negotiate({ thinkingEffort: 'high', attempt })
    await negotiate({ thinkingEffort: 'high', attempt })

    expect(variants).toEqual([
      { includeThinking: true, useFallbackThinking: false, useFallbackAuth: false },
      { includeThinking: true, useFallbackThinking: true, useFallbackAuth: false },
      { includeThinking: true, useFallbackThinking: true, useFallbackAuth: false }
    ])
  })

  it('user gets fallback auth applied to the shape retry when both are rejected, then no duplicate request is sent', async () => {
    const { variants, attempt } = createRecorder([
      statusResponse(401),
      statusResponse(400),
      statusResponse(200)
    ])
    const negotiate = createRequestNegotiator({
      supportsFallbackAuth: true,
      supportsFallbackThinking: true
    })

    const response = await negotiate({ thinkingEffort: 'high', attempt })

    expect(response.status).toBe(200)
    expect(variants).toHaveLength(3)
    expect(variants[2]).toEqual({
      includeThinking: true,
      useFallbackThinking: true,
      useFallbackAuth: true
    })
  })

  it('user sees server failures stay observable when the endpoint errors, then no retry hides them', async () => {
    const { variants, attempt } = createRecorder([statusResponse(500)])
    const negotiate = createRequestNegotiator({
      supportsFallbackAuth: true,
      supportsFallbackThinking: true
    })

    const response = await negotiate({ thinkingEffort: 'high', attempt })

    expect(response.status).toBe(500)
    expect(variants).toHaveLength(1)
  })
})
