import { CodeToTokenTransformStream, type RecallToken } from '@shikijs/stream'
import { createHighlighterCore, type HighlighterCore, type ThemedToken } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { bundledLanguages } from 'shiki/langs'

const themeLoaders = {
  'catppuccin-latte': () => import('@shikijs/themes/catppuccin-latte'),
  'catppuccin-mocha': () => import('@shikijs/themes/catppuccin-mocha'),
  dracula: () => import('@shikijs/themes/dracula'),
  'github-dark': () => import('@shikijs/themes/github-dark'),
  'github-light': () => import('@shikijs/themes/github-light'),
  'gruvbox-dark-medium': () => import('@shikijs/themes/gruvbox-dark-medium'),
  'gruvbox-light-medium': () => import('@shikijs/themes/gruvbox-light-medium'),
  'material-theme-lighter': () => import('@shikijs/themes/material-theme-lighter'),
  'material-theme-palenight': () => import('@shikijs/themes/material-theme-palenight'),
  monokai: () => import('@shikijs/themes/monokai'),
  nord: () => import('@shikijs/themes/nord'),
  'one-dark-pro': () => import('@shikijs/themes/one-dark-pro'),
  'rose-pine-dawn': () => import('@shikijs/themes/rose-pine-dawn'),
  'rose-pine-moon': () => import('@shikijs/themes/rose-pine-moon'),
  'solarized-dark': () => import('@shikijs/themes/solarized-dark'),
  'solarized-light': () => import('@shikijs/themes/solarized-light'),
  'tokyo-night': () => import('@shikijs/themes/tokyo-night'),
  'vitesse-dark': () => import('@shikijs/themes/vitesse-dark'),
  'vitesse-light': () => import('@shikijs/themes/vitesse-light')
}

type StreamingCodeHighlightInput = {
  code: string
  isStreaming: boolean
  language?: string
}

type StableCode = {
  stable: string
  tail: string
}

type StreamingCodeHighlight = {
  isFallback: boolean
  lines: ThemedToken[][]
  rawTail: string
}

type StreamingCodeHighlighterOptions = {
  createHighlighter?: () => Promise<HighlighterCore>
  onTokens?: (highlight: StreamingCodeHighlight) => void
  themes?: { dark: string; light: string }
}

type StreamingCodeHighlighter = {
  update(input: StreamingCodeHighlightInput): Promise<StreamingCodeHighlight>
  reset(): Promise<void>
  dispose(): Promise<void>
}

type HighlightSession = {
  closed: boolean
  generation: number
  highlighter: HighlighterCore
  language: string
  lineBreaksBeforeToken: number[]
  lineCache: {
    dirtyTokenIndex: number | null
    lines: ThemedToken[][]
    revision: number
    snapshotRevision: number
  }
  publicationCancel: (() => void) | null
  publicationScheduled: boolean
  published: number
  publishWaiters: Array<() => void>
  reader: ReadableStreamDefaultReader<ThemedToken | RecallToken>
  readerTask: Promise<void>
  rawTail: string
  stableCode: string
  tokens: ThemedToken[]
  writer: WritableStreamDefaultWriter<string>
  failure: unknown
}

function splitStableCode(code: string, _isStreaming: boolean): StableCode {
  // Feed the current tail into Shiki's recall-capable stream so it can update
  // tokens as a line grows instead of leaving the tail as permanently raw text.
  return { stable: code, tail: '' }
}

function countLineBreaks(content: string): number {
  let count = 0
  for (const character of content) {
    if (character === '\n') count += 1
  }
  return count
}

function markTokenLinesDirty(session: HighlightSession, tokenIndex: number): void {
  session.lineCache.dirtyTokenIndex = Math.min(
    session.lineCache.dirtyTokenIndex ?? tokenIndex,
    tokenIndex
  )
  session.lineCache.revision += 1
}

function applyStreamingToken(session: HighlightSession, token: ThemedToken | RecallToken): void {
  if ('recall' in token) {
    const tokenIndex = Math.max(0, session.tokens.length - token.recall)
    if (tokenIndex === session.tokens.length) return

    session.tokens.splice(tokenIndex, token.recall)
    session.lineBreaksBeforeToken.splice(tokenIndex, token.recall)
    markTokenLinesDirty(session, tokenIndex)
    return
  }

  const previousTokenIndex = session.tokens.length - 1
  const lineBreaksBeforeToken =
    previousTokenIndex < 0
      ? 0
      : session.lineBreaksBeforeToken[previousTokenIndex] +
        countLineBreaks(session.tokens[previousTokenIndex].content)

  session.lineBreaksBeforeToken.push(lineBreaksBeforeToken)
  markTokenLinesDirty(session, session.tokens.length)
  session.tokens.push(token)
}

function isAppendOnly(previous: string, next: string): boolean {
  return next.startsWith(previous)
}

function appendTokenToLines(
  lines: ThemedToken[][],
  token: ThemedToken,
  content = token.content
): void {
  const parts = content.split('\n')

  for (const [index, part] of parts.entries()) {
    if (part) lines.at(-1)?.push({ ...token, content: part })
    if (index < parts.length - 1) lines.push([])
  }
}

function getLineBreakCountBeforeToken(session: HighlightSession, tokenIndex: number): number {
  if (tokenIndex < session.lineBreaksBeforeToken.length) {
    return session.lineBreaksBeforeToken[tokenIndex]
  }

  const previousTokenIndex = tokenIndex - 1
  if (previousTokenIndex < 0) return 0

  return (
    session.lineBreaksBeforeToken[previousTokenIndex] +
    countLineBreaks(session.tokens[previousTokenIndex].content)
  )
}

function rebuildTokenLines(session: HighlightSession, dirtyTokenIndex: number): ThemedToken[][] {
  const reusableLineCount = getLineBreakCountBeforeToken(session, dirtyTokenIndex)
  let rebuildTokenIndex = 0
  let rebuildContentOffset = 0

  for (let tokenIndex = dirtyTokenIndex - 1; tokenIndex >= 0; tokenIndex -= 1) {
    const lineBreakIndex = session.tokens[tokenIndex].content.lastIndexOf('\n')
    if (lineBreakIndex === -1) continue

    rebuildTokenIndex = tokenIndex
    rebuildContentOffset = lineBreakIndex + 1
    break
  }

  const rebuiltLines: ThemedToken[][] = [[]]
  for (let tokenIndex = rebuildTokenIndex; tokenIndex < session.tokens.length; tokenIndex += 1) {
    const token = session.tokens[tokenIndex]
    appendTokenToLines(
      rebuiltLines,
      token,
      tokenIndex === rebuildTokenIndex ? token.content.slice(rebuildContentOffset) : token.content
    )
  }

  if (session.tokens.at(-1)?.content.endsWith('\n')) rebuiltLines.pop()

  return [...session.lineCache.lines.slice(0, reusableLineCount), ...rebuiltLines]
}

function getTokenLines(session: HighlightSession): ThemedToken[][] {
  if (session.lineCache.snapshotRevision === session.lineCache.revision) {
    return session.lineCache.lines
  }

  session.lineCache.lines = rebuildTokenLines(session, session.lineCache.dirtyTokenIndex ?? 0)
  session.lineCache.dirtyTokenIndex = null
  session.lineCache.snapshotRevision = session.lineCache.revision
  return session.lineCache.lines
}

async function createDefaultHighlighter(themes: {
  dark: string
  light: string
}): Promise<HighlighterCore> {
  // SAFETY: theme IDs come from the validated app registry; unknown persisted values are rejected below.
  const lightTheme = themeLoaders[themes.light as keyof typeof themeLoaders]
  // SAFETY: theme IDs come from the validated app registry; unknown persisted values are rejected below.
  const darkTheme = themeLoaders[themes.dark as keyof typeof themeLoaders]
  if (!lightTheme || !darkTheme) throw new Error('Unsupported syntax highlighting theme.')

  return createHighlighterCore({
    // The renderer CSP disallows WASM compilation, so use the browser-safe regex engine.
    engine: createJavaScriptRegexEngine(),
    langs: [],
    themes: [lightTheme(), darkTheme()]
  })
}

class StreamingCodeHighlighterSession implements StreamingCodeHighlighter {
  private readonly createHighlighter: () => Promise<HighlighterCore>
  private readonly onTokens: ((highlight: StreamingCodeHighlight) => void) | undefined
  private readonly themes: { dark: string; light: string }
  private generation = 0
  private operation = Promise.resolve()
  private disposed = false
  private session: HighlightSession | null = null

  constructor({
    createHighlighter: createHighlighterOption,
    onTokens,
    themes = { dark: 'github-dark', light: 'github-light' }
  }: StreamingCodeHighlighterOptions) {
    this.createHighlighter = createHighlighterOption ?? (() => createDefaultHighlighter(themes))
    this.onTokens = onTokens
    this.themes = themes
  }

  update(input: StreamingCodeHighlightInput): Promise<StreamingCodeHighlight> {
    return this.enqueue(() => this.updateSession(input))
  }

  reset(): Promise<void> {
    return this.interruptSession()
  }

  dispose(): Promise<void> {
    this.disposed = true
    return this.interruptSession()
  }

  private enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.operation.then(operation)
    this.operation = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private interruptSession(): Promise<void> {
    const reset = this.resetSession()
    this.operation = this.operation.then(
      (): Promise<void> => reset,
      (): Promise<void> => reset
    )
    return reset
  }

  private async updateSession(input: StreamingCodeHighlightInput): Promise<StreamingCodeHighlight> {
    if (this.disposed || !input.language) return this.rawFallback(input.code)

    const { stable, tail } = splitStableCode(input.code, input.isStreaming)
    const current = this.session

    if (
      current &&
      (current.language !== input.language ||
        !isAppendOnly(current.stableCode, stable) ||
        (current.closed && current.stableCode !== stable))
    ) {
      await this.resetSession()
    }

    if (!stable) {
      return { isFallback: false, lines: [], rawTail: tail }
    }

    try {
      const session = this.session ?? (await this.startSession(input.language))
      if (!this.isCurrentSession(session)) return this.rawFallback(input.code)

      const suffix = stable.slice(session.stableCode.length)
      session.rawTail = tail

      if (suffix) {
        const published = session.published
        await session.writer.write(suffix)
        session.stableCode = stable
        await this.waitForPublication(session, published)
      }

      if (!this.isCurrentSession(session)) return this.rawFallback(input.code)

      if (!input.isStreaming && !session.closed) {
        await session.writer.close()
        session.closed = true
        await session.readerTask
      }

      if (session.failure) return this.failSession(input.code)

      return {
        isFallback: false,
        lines: getTokenLines(session),
        rawTail: tail
      }
    } catch {
      return this.failSession(input.code)
    }
  }

  private async startSession(language: string): Promise<HighlightSession> {
    const generation = ++this.generation
    const highlighter = await this.createHighlighter()

    try {
      // SAFETY: the runtime fence value is used only for a lookup; unsupported values are rejected below.
      const languageLoader = bundledLanguages[language as keyof typeof bundledLanguages]
      if (!languageLoader) throw new Error('Unsupported syntax highlighting language.')
      await highlighter.loadLanguage(languageLoader)

      if (this.disposed || generation !== this.generation) {
        throw new Error('Streaming highlighter session was invalidated')
      }

      const input = new TransformStream<string, string>()
      const output = input.readable.pipeThrough(
        new CodeToTokenTransformStream({
          allowRecalls: true,
          highlighter,
          lang: language,
          themes: this.themes
        })
      )
      const reader = output.getReader()
      const session: HighlightSession = {
        closed: false,
        failure: null,
        generation,
        highlighter,
        language,
        lineBreaksBeforeToken: [],
        lineCache: {
          dirtyTokenIndex: null,
          lines: [[]],
          revision: 0,
          snapshotRevision: 0
        },
        publicationCancel: null,
        publicationScheduled: false,
        published: 0,
        publishWaiters: [],
        reader,
        readerTask: Promise.resolve(),
        rawTail: '',
        stableCode: '',
        tokens: [],
        writer: input.writable.getWriter()
      }

      session.readerTask = this.consumeTokens(session)
      this.session = session
      return session
    } catch (error) {
      highlighter.dispose()
      throw error
    }
  }

  private async consumeTokens(session: HighlightSession): Promise<void> {
    try {
      while (true) {
        const { done, value } = await session.reader.read()
        if (done || session.generation !== this.generation) return
        applyStreamingToken(session, value)
        this.schedulePublication(session)
      }
    } catch (error) {
      if (session.generation === this.generation) {
        session.failure = error
        this.resolvePublicationWaiters(session)
      }
    }
  }

  private schedulePublication(session: HighlightSession): void {
    if (
      session.generation !== this.generation ||
      this.session !== session ||
      session.publicationScheduled
    ) {
      return
    }

    session.publicationScheduled = true
    const flush = (): void => {
      session.publicationCancel = null
      session.publicationScheduled = false
      this.publish(session)
    }

    const frame = window.requestAnimationFrame(flush)
    session.publicationCancel = (): void => window.cancelAnimationFrame(frame)
  }

  private publish(session: HighlightSession): void {
    if (session.generation !== this.generation || this.session !== session) return

    session.published += 1
    this.onTokens?.({
      isFallback: false,
      lines: getTokenLines(session),
      rawTail: session.rawTail
    })
    this.resolvePublicationWaiters(session)
  }

  private async waitForPublication(session: HighlightSession, published: number): Promise<void> {
    if (session.published > published || session.failure) return

    await new Promise<void>((resolve) => {
      session.publishWaiters.push(resolve)
    })
  }

  private resolvePublicationWaiters(session: HighlightSession): void {
    for (const resolve of session.publishWaiters.splice(0)) resolve()
  }

  private isCurrentSession(session: HighlightSession): boolean {
    return !this.disposed && session.generation === this.generation && this.session === session
  }

  private async resetSession(): Promise<void> {
    this.generation += 1
    const session = this.session
    this.session = null
    if (!session) return

    session.publicationCancel?.()
    session.publicationCancel = null
    session.publicationScheduled = false
    this.resolvePublicationWaiters(session)
    await Promise.allSettled([session.writer.abort(), session.reader.cancel()])
    session.writer.releaseLock()
    session.reader.releaseLock()
    await session.readerTask
    session.highlighter.dispose()
    this.resolvePublicationWaiters(session)
  }

  private async failSession(code: string): Promise<StreamingCodeHighlight> {
    await this.resetSession()
    return this.rawFallback(code)
  }

  private rawFallback(code: string): StreamingCodeHighlight {
    return { isFallback: true, lines: [], rawTail: code }
  }
}

function createStreamingCodeHighlighter(
  options: StreamingCodeHighlighterOptions = {}
): StreamingCodeHighlighter {
  return new StreamingCodeHighlighterSession(options)
}

export {
  createStreamingCodeHighlighter,
  splitStableCode,
  type StreamingCodeHighlight,
  type StreamingCodeHighlightInput,
  type StreamingCodeHighlighter,
  type StreamingCodeHighlighterOptions
}
