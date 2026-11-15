import { TextGeneration } from '@mico/agent-core'
import { type ChatProvider, providerFinish } from '@mico/ai-providers'
import { describe, expect, it, vi } from 'vitest'
import { TitleGenerator } from './title-generator'

describe('TitleGenerator', () => {
  it('user sees a title capped at 50 characters when generation returns more, then the rest is trimmed', async () => {
    const textGeneration = new TextGeneration()
    const renameAttempt = Promise.withResolvers<string>()
    const renameIfCurrentTitle = vi.fn<
      ConstructorParameters<typeof TitleGenerator>[0]['renameIfCurrentTitle']
    >((_sessionId, _currentTitle, title) => {
      renameAttempt.resolve(title)
      return null
    })
    const generator = new TitleGenerator({ textGeneration, renameIfCurrentTitle })
    const provider: ChatProvider = {
      getModelCapabilities: async () => null,
      stream: async () => ({
        async *[Symbol.asyncIterator]() {
          yield { type: 'text-delta' as const, id: 'title', delta: `Title: "${'😀'.repeat(51)}"!` }
          yield providerFinish({ reason: 'stop' })
        }
      })
    }

    generator.maybeGenerate({
      sessionId: 'session',
      provider,
      sourceText: 'Hello',
      signal: new AbortController().signal
    })

    expect(await renameAttempt.promise).toBe('😀'.repeat(50))
    expect(renameIfCurrentTitle).toHaveBeenCalledWith('session', 'New chat', '😀'.repeat(50))
    await textGeneration.drain()
  })
})
