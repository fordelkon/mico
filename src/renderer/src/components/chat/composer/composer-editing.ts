import type { ComposerToken } from './draft/composer-draft-types'

type TextRange = { start: number; end: number }

/**
 * Range a collapsed plain Backspace removes: the whole token (invocation or
 * paste label) when the caret sits inside it or at its end; otherwise the
 * browser deletes one character on its own.
 */
function backspaceDeletion(tokens: readonly ComposerToken[], caret: number): TextRange | null {
  const token = tokens.find(({ start, end }) => start < caret && caret <= end)
  if (!token) return null
  return { start: token.start, end: token.end }
}

/**
 * Range Ctrl/Cmd+Backspace removes when the caret sits at a token end or
 * directly behind one ASCII separator: the whole token (plus that separator)
 * instead of the browser's partial word deletion that would leave a fragment
 * behind. Carets elsewhere keep native word deletion.
 */
function wordBackspaceDeletion(
  text: string,
  tokens: readonly ComposerToken[],
  caret: number
): TextRange | null {
  for (const token of tokens) {
    if (caret <= token.start) continue
    if (caret <= token.end) return { start: token.start, end: token.end }
    if (caret === token.end + 1 && text[token.end] === ' ') {
      return { start: token.start, end: caret }
    }
  }
  return null
}

/**
 * Caret position for a plain arrow press that would otherwise land inside a
 * token: it jumps past the whole token. Shift, selection, and IME editing keep
 * the browser's native per-character movement.
 */
function arrowTokenJump(
  tokens: readonly ComposerToken[],
  caret: number,
  direction: 'left' | 'right'
): number | null {
  for (const token of tokens) {
    if (direction === 'left' && caret > token.start && caret <= token.end) return token.start
    if (direction === 'right' && caret >= token.start && caret < token.end) return token.end
  }
  return null
}

export { arrowTokenJump, backspaceDeletion, wordBackspaceDeletion, type TextRange }
