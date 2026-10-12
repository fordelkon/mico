import * as React from 'react'

import type { ComposerToken } from './composer-tokens'

type Props = {
  draft: string
  /** Hides the mirror so IME composition shows the native textarea glyphs. */
  hidden?: boolean
  tokens: readonly ComposerToken[]
  /**
   * The observed textarea element, held in state so this effect re-runs when
   * the element mounts. The mirror renders before the textarea sibling, so a
   * ref read inside the layout effect can still be null on remount and the
   * sync (and its ResizeObserver) would never be established.
   */
  textarea: HTMLTextAreaElement | null
}

/**
 * Renders the visible text for the composer: the native textarea keeps focus,
 * the caret, and selection but paints its glyphs transparent, while this
 * mirror paints the identical layout with invocation tokens colored. During
 * IME composition the mirror hides and the textarea shows its native text so
 * composition underlines stay visible.
 */
function ComposerTokenHighlight({
  draft,
  hidden,
  tokens,
  textarea
}: Props): React.JSX.Element | null {
  const mirrorRef = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    const mirror = mirrorRef.current
    if (!textarea || !mirror) return

    const syncMirror = (): void => {
      const style = window.getComputedStyle(textarea)
      // Use the actual control metrics, including responsive typography and
      // scrollbar width. Token spans must never add padding or change fonts.
      for (const property of [
        'font-family',
        'font-size',
        'font-weight',
        'font-style',
        'font-variant',
        'font-feature-settings',
        'font-variation-settings',
        'line-height',
        'letter-spacing',
        'text-align',
        'text-indent',
        'text-transform',
        'direction',
        'white-space',
        'word-break',
        'overflow-wrap',
        'tab-size',
        'padding-top',
        'padding-right',
        'padding-bottom',
        'padding-left'
      ]) {
        mirror.style.setProperty(property, style.getPropertyValue(property))
      }
      mirror.style.width = `${textarea.clientWidth}px`
      mirror.style.height = `${textarea.clientHeight}px`
      mirror.scrollTop = textarea.scrollTop
      mirror.scrollLeft = textarea.scrollLeft
    }
    const syncScroll = (): void => {
      mirror.scrollTop = textarea.scrollTop
      mirror.scrollLeft = textarea.scrollLeft
    }
    syncMirror()
    const observer = new ResizeObserver(syncMirror)
    observer.observe(textarea)
    textarea.addEventListener('scroll', syncScroll)
    return () => {
      observer.disconnect()
      textarea.removeEventListener('scroll', syncScroll)
    }
  }, [draft, textarea])

  const segments: Array<React.ReactNode> = []
  let cursor = 0
  for (const token of tokens) {
    if (token.start > cursor) segments.push(draft.slice(cursor, token.start))
    segments.push(
      <span key={token.start} data-token-kind={token.kind} className="text-brand">
        {draft.slice(token.start, token.end)}
      </span>
    )
    cursor = token.end
  }
  if (cursor < draft.length) segments.push(draft.slice(cursor))
  // A textarea keeps the last empty line after a newline; an ordinary div
  // needs an invisible glyph there to preserve the same scrollable height.
  if (draft.endsWith('\n')) segments.push('​')

  return (
    <div
      ref={mirrorRef}
      aria-hidden="true"
      style={hidden ? { visibility: 'hidden' } : undefined}
      className="chat-composer__mirror pointer-events-none absolute left-0 top-0 z-0 box-border overflow-hidden select-none"
    >
      {segments}
    </div>
  )
}

export { ComposerTokenHighlight }
