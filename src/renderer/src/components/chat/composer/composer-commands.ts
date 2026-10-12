const COMPACT_COMMAND = {
  kind: 'command' as const,
  id: 'compact',
  name: 'compact',
  token: '/compact',
  label: 'Compact context',
  description: 'Summarize this conversation to free context space.'
}

type CompactCommandDraft = {
  start: number
  end: number
  arguments: string
}

/** Recognize the local command independently of menu queries and catalog readiness. */
function readCompactCommand(draft: string): CompactCommandDraft | null {
  const trimmed = draft.trim()
  if (!trimmed.startsWith(COMPACT_COMMAND.token)) return null
  const separator = trimmed[COMPACT_COMMAND.token.length]
  if (separator !== undefined && !/\s/.test(separator)) return null
  const start = draft.length - draft.trimStart().length
  return {
    start,
    end: start + COMPACT_COMMAND.token.length,
    arguments: trimmed.slice(COMPACT_COMMAND.token.length).trimStart()
  }
}

export { COMPACT_COMMAND, readCompactCommand }
