import { createHighlighter, type HighlighterCore, type ThemedToken } from 'shiki'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createStreamingCodeHighlighter } from './streaming-code-highlighter'

function getCode(lines: ThemedToken[][]): string {
  return lines.map((line) => line.map((token) => token.content).join('')).join('\n')
}

async function createTestHighlighter(): Promise<HighlighterCore> {
  return createHighlighter({
    langs: ['typescript'],
    themes: ['github-light', 'github-dark']
  })
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number =>
    window.setTimeout(() => callback(performance.now()))
  )
  vi.stubGlobal('cancelAnimationFrame', window.clearTimeout)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('createStreamingCodeHighlighter', () => {
  it('highlights completed streamed lines while preserving the unfinished tail as source', async () => {
    const session = createStreamingCodeHighlighter({ createHighlighter: createTestHighlighter })

    const highlight = await session.update({
      code: 'const answer = 42\nconst pending',
      isStreaming: true,
      language: 'typescript'
    })

    expect(highlight.isFallback).toBe(false)
    expect(getCode(highlight.lines)).toBe('const answer = 42')
    expect(highlight.rawTail).toBe('const pending')
    await session.dispose()
  })

  it('does not publish a new highlight when only the unfinished streamed tail grows', async () => {
    const publications: ThemedToken[][][] = []
    vi.useFakeTimers()
    const session = createStreamingCodeHighlighter({
      createHighlighter: createTestHighlighter,
      onTokens: (highlight) => publications.push(highlight.lines)
    })

    const initialUpdate = session.update({
      code: 'const answer = 42\nconst pending',
      isStreaming: true,
      language: 'typescript'
    })
    await vi.runAllTimersAsync()
    await initialUpdate
    await vi.runAllTimersAsync()
    const publishedCompletedLines = publications.length

    await session.update({
      code: 'const answer = 42\nconst pendingValue',
      isStreaming: true,
      language: 'typescript'
    })
    await vi.runAllTimersAsync()

    expect(publications).toHaveLength(publishedCompletedLines)
    await session.dispose()
  })

  it('returns original source when highlighting cannot initialize', async () => {
    const session = createStreamingCodeHighlighter({
      createHighlighter: async () => Promise.reject(new Error('Shiki unavailable'))
    })

    await expect(
      session.update({
        code: 'const answer = 42\n',
        isStreaming: false,
        language: 'typescript'
      })
    ).resolves.toEqual({
      isFallback: true,
      lines: [],
      rawTail: 'const answer = 42\n'
    })
  })

  it('returns original source when the fence language cannot load', async () => {
    const highlighter = await createTestHighlighter()
    vi.spyOn(highlighter, 'loadLanguage').mockRejectedValue(new Error('Language unavailable'))
    const session = createStreamingCodeHighlighter({
      createHighlighter: async (): Promise<HighlighterCore> => highlighter
    })

    await expect(
      session.update({
        code: 'const answer = 42\n',
        isStreaming: false,
        language: 'typescript'
      })
    ).resolves.toEqual({
      isFallback: true,
      lines: [],
      rawTail: 'const answer = 42\n'
    })
  })

  it('resolves an interrupted update with its raw source', async () => {
    let frameCallback: FrameRequestCallback | undefined
    let resolveFrameRequest: (() => void) | undefined
    const frameRequested = new Promise<void>((resolve): void => {
      resolveFrameRequest = resolve
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      frameCallback = callback
      resolveFrameRequest?.()
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', (): void => undefined)

    const session = createStreamingCodeHighlighter({ createHighlighter: createTestHighlighter })
    const update = session.update({
      code: 'const answer = 42\n',
      isStreaming: true,
      language: 'typescript'
    })
    await frameRequested

    const dispose = session.dispose()
    let completed = false

    try {
      completed = await Promise.race([
        dispose.then((): boolean => true),
        new Promise<boolean>((resolve): number => window.setTimeout(() => resolve(false)))
      ])

      expect(completed).toBe(true)
      await expect(update).resolves.toEqual({
        isFallback: true,
        lines: [],
        rawTail: 'const answer = 42\n'
      })
    } finally {
      if (!completed) frameCallback?.(performance.now())
      await Promise.allSettled([update, dispose])
    }
  })

  it('highlights Python when WebAssembly compilation is unavailable', async () => {
    vi.spyOn(WebAssembly, 'instantiate').mockRejectedValue(
      new WebAssembly.CompileError('WebAssembly is blocked by CSP')
    )
    const session = createStreamingCodeHighlighter()

    try {
      await expect(
        session.update({
          code: 'print("Hello world")',
          isStreaming: false,
          language: 'python'
        })
      ).resolves.toMatchObject({ isFallback: false })
    } finally {
      await session.dispose()
    }
  })
})
