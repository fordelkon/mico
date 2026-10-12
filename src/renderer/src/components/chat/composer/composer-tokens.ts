type ComposerToken = {
  start: number
  end: number
  kind: 'command' | 'skill' | 'paste'
}

function isCompactDraft(draft: string): boolean {
  return /^\/compact(?:\s|$)/.test(draft.trim())
}

function tokenizeComposerDraft(draft: string, skillNames: ReadonlySet<string>): ComposerToken[] {
  const tokens: ComposerToken[] = []
  if (isCompactDraft(draft)) {
    const start = draft.length - draft.trimStart().length
    tokens.push({ start, end: start + '/compact'.length, kind: 'command' })
  }

  // Skill highlighting accepts exactly one `$name` invocation at offset zero;
  // the historic `/skill:` form is plain text. Arguments and
  // whitespace-prefixed references remain ordinary text.
  const invocation = /^\$([^\s]+)(?:\s|$)/.exec(draft)
  if (invocation && skillNames.has(invocation[1])) {
    const end = draft.search(/\s/)
    tokens.push({ start: 0, end: end === -1 ? draft.length : end, kind: 'skill' })
  }

  return tokens
}

export { isCompactDraft, tokenizeComposerDraft, type ComposerToken }
