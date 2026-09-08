import { bundledLanguages, type ThemedToken } from 'shiki'
import * as React from 'react'

import {
  createStreamingCodeHighlighter,
  splitStableCode,
  type StreamingCodeHighlight,
  type StreamingCodeHighlighter
} from './streaming-code-highlighter'

type StreamingCodeHighlightOptions = {
  code: string
  isStreaming: boolean
  language?: string
}

type StreamingCodeHighlightState = {
  isFallback: boolean
  source: { code: string; language?: string }
  tokenLines: ThemedToken[][] | null
}

type StreamingCodeHighlightSession = {
  code: string
  highlighter: StreamingCodeHighlighter
  isStreaming: boolean
  language: string
  stableCode: string
}

const rawCodeState = (code: string, language?: string): StreamingCodeHighlightState => ({
  isFallback: true,
  source: { code, language },
  tokenLines: null
})

function isSupportedLanguage(language: string): boolean {
  return Object.hasOwn(bundledLanguages, language)
}

function useStreamingCodeHighlight({
  code,
  isStreaming,
  language
}: StreamingCodeHighlightOptions): StreamingCodeHighlightState {
  const [state, setState] = React.useState<StreamingCodeHighlightState>(() =>
    rawCodeState(code, language)
  )
  const generationRef = React.useRef(0)
  const sessionRef = React.useRef<StreamingCodeHighlightSession | null>(null)
  const publishHighlight = React.useEffectEvent((highlight: StreamingCodeHighlight) => {
    setState({
      isFallback: highlight.isFallback,
      source: { code, language },
      tokenLines: highlight.isFallback ? null : highlight.lines
    })
  })

  React.useEffect(() => {
    if (!language || !isSupportedLanguage(language)) {
      generationRef.current += 1
      const previousSession = sessionRef.current
      sessionRef.current = null
      void previousSession?.highlighter.dispose()
      return
    }

    const stableCode = splitStableCode(code, isStreaming).stable
    const currentSession = sessionRef.current
    const needsNewSession =
      !currentSession ||
      currentSession.language !== language ||
      !code.startsWith(currentSession.code)

    if (needsNewSession) {
      const generation = ++generationRef.current
      const previousSession = sessionRef.current
      if (!stableCode) {
        sessionRef.current = null
        void previousSession?.highlighter.dispose()
        return
      }

      const highlighter = createStreamingCodeHighlighter({
        onTokens: (highlight) => {
          if (generation !== generationRef.current) return

          publishHighlight(highlight)
        }
      })
      const session = { code, highlighter, isStreaming, language, stableCode }
      sessionRef.current = session
      void previousSession?.highlighter.dispose()

      void highlighter.update({ code, isStreaming, language })
      return
    }

    if (currentSession.stableCode === stableCode && currentSession.isStreaming === isStreaming) {
      // The raw tail renders from current props; publishing it would add a React update per token.
      currentSession.code = code
      return
    }

    currentSession.code = code
    currentSession.isStreaming = isStreaming
    currentSession.stableCode = stableCode

    void currentSession.highlighter.update({ code, isStreaming, language })
  }, [code, isStreaming, language])

  React.useEffect(
    () => () => {
      generationRef.current += 1
      const session = sessionRef.current
      sessionRef.current = null
      void session?.highlighter.dispose()
    },
    []
  )

  return state
}

export { useStreamingCodeHighlight }
