import type { ComposerPasteToken } from '@renderer/hooks/chat/chat-composer-drafts'

/** Visible, collision-checked IDs keep the textarea and mirror metrically identical. */
function createPasteToken(
  text: string,
  existing: readonly ComposerPasteToken[],
  start: number
): ComposerPasteToken {
  const id = crypto.randomUUID()
  let shortId = id.replaceAll('-', '').slice(0, 6)
  while (existing.some((token) => token.displayText.endsWith(`· ${shortId}]`))) {
    shortId = crypto.randomUUID().replaceAll('-', '').slice(0, 6)
  }
  const displayText = `[Pasted ${text.length.toLocaleString('en-US')} chars · ${shortId}]`
  return {
    id,
    text,
    displayText,
    start,
    end: start + displayText.length,
    state: 'retired',
    damagedTexts: []
  }
}

type TextEdit = { start: number; end: number; nextEnd: number }

function textEdit(previous: string, next: string): TextEdit {
  let start = 0
  while (start < previous.length && start < next.length && previous[start] === next[start]) {
    start += 1
  }
  let end = previous.length
  let nextEnd = next.length
  while (end > start && nextEnd > start && previous[end - 1] === next[nextEnd - 1]) {
    end -= 1
    nextEnd -= 1
  }
  return { start, end, nextEnd }
}

/** Observe input events; Chromium alone owns the undo/redo transactions. */
function reconcilePasteTokens(
  previous: string,
  next: string,
  tokens: ComposerPasteToken[]
): ComposerPasteToken[] {
  if (previous === next) return tokens
  const edit = textEdit(previous, next)
  const delta = edit.nextEnd - edit.end

  return tokens.map((token) => {
    const exact = next.indexOf(token.displayText)
    if (exact !== -1) {
      if (token.state === 'active' && token.start === exact) return token
      return { ...token, start: exact, end: exact + token.displayText.length, state: 'active' }
    }
    // Broken variants carry no identity beyond the token's own short ID. A
    // variant only revives at the anchored range — the edit-adjusted position
    // for a live token, the edit location for a retired one — never through an
    // unanchored substring match against ordinary message text.
    const isBefore = edit.end <= token.start
    const anchoredStart = isBefore
      ? token.start + delta
      : edit.start < token.start && edit.end > token.start
        ? edit.start
        : token.start
    const identity = token.displayText.slice(-10)
    const anchor = token.state === 'retired' ? edit.start : anchoredStart
    const restoredDamage = token.damagedTexts.find(
      (text) =>
        text.includes(identity) &&
        next.slice(anchor, anchor + text.length) === text &&
        (token.state === 'damaged' || (edit.start < anchor + text.length && edit.nextEnd > anchor))
    )
    if (restoredDamage) {
      return { ...token, start: anchor, end: anchor + restoredDamage.length, state: 'damaged' }
    }
    // A retired label is not in the value; freeze it until the exact label or
    // an anchored broken variant returns.
    if (token.state === 'retired') return token
    if (edit.end > edit.start && edit.start <= token.start && edit.end >= token.end) {
      // Replacing or deleting the whole label is intentional removal. Keep
      // its payload retired so undo restoring the exact label can recover it.
      return { ...token, start: edit.start, end: edit.start, state: 'retired' }
    }
    if (edit.end <= token.start) {
      return { ...token, start: token.start + delta, end: token.end + delta }
    }
    if (edit.start >= token.end) return token
    const start = Math.min(token.start, edit.start)
    const end = Math.max(edit.nextEnd, token.end + delta)
    const broken = next.slice(start, end)
    return {
      ...token,
      start,
      end,
      state: 'damaged',
      damagedTexts:
        broken && !token.damagedTexts.includes(broken)
          ? [...token.damagedTexts, broken]
          : token.damagedTexts
    }
  })
}

function pasteTokenIssue(value: string, tokens: readonly ComposerPasteToken[]): string | null {
  if (tokens.some((token) => token.state === 'damaged')) {
    return 'A pasted text token was edited. Its original text is kept. Restore it, undo the edit, or remove the token before sending.'
  }
  const labels = value.match(/\[Pasted \d[\d,]* chars · [0-9a-f]{6}\]/g) ?? []
  if (
    labels.some(
      (label) => !tokens.some((token) => token.state === 'active' && token.displayText === label)
    )
  ) {
    return 'A pasted text token has no original text in this draft. Delete that token and paste the original text again before sending.'
  }
  if (
    tokens.some(
      (token) => token.state === 'active' && value.indexOf(token.displayText, token.end) !== -1
    )
  ) {
    return 'A pasted text token appears more than once. Delete the duplicate token and paste the original text again before sending.'
  }
  return null
}

/** Expand only source ranges, never recursively rewrite an inserted payload. */
function expandPasteTokens(value: string, tokens: readonly ComposerPasteToken[]): string {
  let cursor = 0
  let expanded = ''
  const active = tokens
    .filter((token) => token.state === 'active')
    .sort((left, right) => left.start - right.start)
  for (const token of active) {
    expanded += value.slice(cursor, token.start) + token.text
    cursor = token.end
  }
  return expanded + value.slice(cursor)
}

/** Touching any part of a token copies its entire original text. */
function pasteClipboardText(
  value: string,
  tokens: readonly ComposerPasteToken[],
  selectionStart: number,
  selectionEnd: number
): string | null {
  const start = Math.max(0, selectionStart)
  const end = Math.max(start, selectionEnd)
  if (start === end) return null
  const touched = tokens
    .filter((token) => token.state !== 'retired' && token.start < end && token.end > start)
    .sort((left, right) => left.start - right.start)
  if (!touched.length) return null
  let cursor = start
  let clipboardText = ''
  for (const token of touched) {
    if (token.start > cursor) clipboardText += value.slice(cursor, token.start)
    clipboardText += token.text
    cursor = Math.min(end, token.end)
  }
  return clipboardText + value.slice(cursor, end)
}

/**
 * Repair a damaged token through native editing: the broken text at the
 * token's range is replaced by the exact original label, restoring the payload
 * association. The caller applies the edit through the browser transaction
 * seam, so undoing the repair lands on a known broken variant again.
 */
function restorePasteToken(
  value: string,
  token: ComposerPasteToken
): { start: number; end: number } | null {
  const broken = value.slice(token.start, token.end)
  if (!broken || broken === token.displayText) return null
  return { start: token.start, end: token.end }
}

export {
  createPasteToken,
  expandPasteTokens,
  pasteClipboardText,
  pasteTokenIssue,
  reconcilePasteTokens,
  restorePasteToken
}
