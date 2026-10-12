import { readCompactCommand } from './composer-commands'
import type { ComposerToken } from './draft/composer-draft-types'

function tokenizeComposerDraft(draft: string, skillNames: ReadonlySet<string>): ComposerToken[] {
  const tokens: ComposerToken[] = []
  const command = readCompactCommand(draft)
  if (command) tokens.push({ start: command.start, end: command.end, kind: 'command' })

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

export { tokenizeComposerDraft }
