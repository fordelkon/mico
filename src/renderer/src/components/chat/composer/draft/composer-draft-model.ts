import { readCompactCommand } from '../composer-commands'
import { pasteTokenIssue } from '../composer-paste-tokens'
import { tokenizeComposerDraft } from '../composer-tokens'
import type { ChatComposerDraft, ComposerToken } from './composer-draft-types'

type ComposerDraftProjection = {
  tokens: ComposerToken[]
  isCompactCommand: boolean
  hasContent: boolean
  pasteIssue: string | null
  canRepairPaste: boolean
}

/** One sorted, non-overlapping projection supplies atomic editing and highlighting. */
function projectComposerDraft(
  draft: ChatComposerDraft,
  skillNames: ReadonlySet<string>
): ComposerDraftProjection {
  const pasteTokens: ComposerToken[] = draft.pasteTokens
    .filter((token) => token.state !== 'retired')
    .map((token) => ({ start: token.start, end: token.end, kind: 'paste' }))
  // A damaged captured range still owns its glyphs, including any invocation
  // text typed inside it. Invocation styling must not duplicate that range.
  const invocationTokens = tokenizeComposerDraft(draft.text, skillNames).filter(
    (token) => !pasteTokens.some((paste) => paste.start < token.end && paste.end > token.start)
  )
  const candidates = [...invocationTokens, ...pasteTokens].sort(
    (left, right) => left.start - right.start
  )
  const tokens: ComposerToken[] = []
  let end = 0
  for (const token of candidates) {
    if (token.start < end || token.end <= token.start || token.end > draft.text.length) continue
    tokens.push(token)
    end = token.end
  }
  return {
    tokens,
    isCompactCommand: readCompactCommand(draft.text) !== null,
    hasContent: Boolean(draft.text.trim() || draft.documents.length),
    pasteIssue: pasteTokenIssue(draft.text, draft.pasteTokens),
    canRepairPaste: draft.pasteTokens.some((token) => token.state === 'damaged')
  }
}

export { projectComposerDraft }
