import { CheckIcon, CopyIcon, FileCode2Icon } from 'lucide-react'
import * as React from 'react'
import { bundledLanguages, bundledThemes, createHighlighter, type Highlighter } from 'shiki'

import { Button, Spinner } from '@mico/ui'
import { cn } from '@mico/ui/lib/utils'

import { useStreamingCodeHighlight } from './use-streaming-code-highlight'

type ChatCodeBlockProps = {
  code: string
  isStreaming: boolean
  language?: string
  /** Embedded output delegates its surface and live announcements to the enclosing trace. */
  outputLabel?: string
  showLineNumbers?: boolean
}
type CodeThemes = { dark: string; light: string }
type CodeToken = { content: string; offset: number; style?: React.CSSProperties }

const highlighterPromises = new Map<string, Promise<Highlighter>>()

function getThemesKey(themes: CodeThemes): string {
  return `${themes.light}\u0000${themes.dark}`
}

function getHighlighter(themes: CodeThemes): Promise<Highlighter> {
  const key = getThemesKey(themes)
  const existing = highlighterPromises.get(key)
  if (existing) return existing

  const highlighter = createHighlighter({ themes: [themes.light, themes.dark], langs: [] })
  highlighterPromises.set(key, highlighter)
  return highlighter
}

export function useCodeTokens(
  code: string,
  language: string,
  themes: CodeThemes
): CodeToken[][] | undefined {
  const themesKey = getThemesKey(themes)
  const key = `${themesKey}\u0000${language}\u0000${code}`
  const [result, setResult] = React.useState<{
    code: string
    key: string
    language: string
    lines: CodeToken[][]
    themesKey: string
  }>()

  React.useEffect(() => {
    if (language === 'text') return

    let cancelled = false
    void getHighlighter(themes)
      .then(async (highlighter) => {
        // SAFETY: bundledLanguages is checked before use; unknown fence languages render as plain text.
        const languageLoader = bundledLanguages[language as keyof typeof bundledLanguages]
        if (!languageLoader) return
        await highlighter.loadLanguage(languageLoader)
        // SAFETY: languageLoader and the persisted theme values were validated above by their bundled registries.
        const shikiLanguage = language as keyof typeof bundledLanguages
        // SAFETY: theme values are only used after createHighlighter accepted them for this session.
        const shikiThemes = {
          dark: themes.dark as keyof typeof bundledThemes,
          light: themes.light as keyof typeof bundledThemes
        }
        const lines = highlighter
          .codeToTokensWithThemes(code, { lang: shikiLanguage, themes: shikiThemes })
          .map((line) =>
            line.map((token) => ({
              content: token.content,
              dark: token.variants.dark?.color,
              light: token.variants.light?.color,
              offset: token.offset
            }))
          )

        if (!cancelled) setResult({ code, key, language, lines, themesKey })
      })
      .catch(() => {
        // Code remains readable while a language or user-selected theme cannot be loaded.
      })

    return () => {
      cancelled = true
    }
  }, [code, key, language, themes, themesKey])

  if (result?.key === key) return result.lines
  if (
    result?.language === language &&
    result.themesKey === themesKey &&
    code.startsWith(result.code)
  ) {
    return result.lines
  }

  return undefined
}

function CodeLine({ code, tokens }: { code: string; tokens?: CodeToken[] }): React.JSX.Element {
  const completeTokens =
    tokens?.map((token) => token.content).join('') === code ? tokens : undefined

  return (
    <span className="pr-4 pl-1 whitespace-pre">
      {completeTokens
        ? completeTokens.map((token) => (
            <span
              data-code-token
              key={`${token.offset}-${token.content}`}
              style={
                // SAFETY: React permits CSS custom properties in a style object, but CSSProperties omits arbitrary --* keys.
                {
                  ...token.style
                }
              }
              className="text-[var(--shiki-light)] dark:text-[var(--shiki-dark)]"
            >
              {token.content}
            </span>
          ))
        : code || ' '}
    </span>
  )
}

function ChatCodeBlock({
  code,
  isStreaming,
  language,
  outputLabel,
  showLineNumbers = true
}: ChatCodeBlockProps): React.JSX.Element {
  const copyTimerRef = React.useRef<number | undefined>(undefined)
  const [copied, setCopied] = React.useState(false)
  const normalizedLanguage = language ?? 'text'
  const { isFallback, source, tokenLines } = useStreamingCodeHighlight({
    code,
    isStreaming,
    language: normalizedLanguage
  })
  const tokens =
    !isFallback && source.language === normalizedLanguage && code.startsWith(source.code)
      ? tokenLines?.map((line) =>
          line.map((token, index) => ({
            content: token.content,
            offset: index,
            style: token.htmlStyle
          }))
        )
      : undefined
  const lines = code.split('\n')

  React.useEffect(
    () => () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current)
    },
    []
  )

  const copy = React.useCallback(async () => {
    await navigator.clipboard?.writeText(code)
    setCopied(true)
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current)
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 1600)
  }, [code])

  return (
    <div
      aria-busy={isStreaming}
      className={cn(
        'w-full overflow-hidden text-sm',
        !outputLabel && 'my-4 rounded-2xl bg-muted/80'
      )}
      data-slot="code-block"
      data-state={isStreaming ? 'streaming' : 'complete'}
      data-testid="code-block"
    >
      <div className={cn('flex items-center gap-2.5', outputLabel ? 'h-8 px-2.5' : 'h-10 px-3')}>
        {outputLabel ? (
          <span className="text-[11px] font-medium text-text-tertiary">{outputLabel}</span>
        ) : (
          <>
            <FileCode2Icon
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground/70"
            />
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/55">
              {normalizedLanguage}
            </span>
            <span
              aria-label={isStreaming ? 'Writing' : 'Ready'}
              className="ml-auto inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-muted-foreground"
            >
              {isStreaming ? (
                <Spinner aria-hidden="true" className="size-3 motion-reduce:animate-none" />
              ) : (
                <CheckIcon className="size-3" />
              )}
              {isStreaming ? 'Writing' : 'Ready'}
            </span>
          </>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={copied ? 'Copied' : 'Copy code'}
          title={copied ? 'Copied' : 'Copy code'}
          onClick={copy}
          className={cn(
            'rounded-full hover:bg-background/70 hover:text-foreground',
            outputLabel && 'ml-auto'
          )}
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </Button>
      </div>
      <div
        role={isStreaming && !outputLabel ? 'log' : undefined}
        aria-live={isStreaming && !outputLabel ? 'polite' : undefined}
        className={cn('overflow-x-auto py-2', !outputLabel && 'border-t border-border')}
      >
        <pre className="m-0 min-w-max font-mono text-xs leading-5 text-foreground/85">
          <code>
            {lines.map((line, index) => (
              <span
                key={`${index}-${line}`}
                className={cn(
                  'grid min-h-5',
                  showLineNumbers
                    ? 'grid-cols-[2.75rem_minmax(0,1fr)]'
                    : 'grid-cols-[minmax(0,1fr)] pl-2'
                )}
              >
                {showLineNumbers ? (
                  <span className="select-none pr-3 text-right tabular-nums text-muted-foreground/35">
                    {index + 1}
                  </span>
                ) : null}
                <CodeLine code={line} tokens={tokens?.[index]} />
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  )
}

export { ChatCodeBlock }
