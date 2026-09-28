type EditRange = { oldText: string; newText: string }

function textLines(text: string): string[] {
  if (!text) return []
  return text.replaceAll('\r\n', '\n').split('\n')
}

/** Shared edge lines are context, not additions or deletions. Offsets are relative to the replacement. */
function editPreview({ oldText, newText }: EditRange) {
  const before = textLines(oldText)
  const after = textLines(newText)
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let end = 0
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - end - 1] === after[after.length - end - 1]
  )
    end++
  return {
    contextBefore: before.slice(Math.max(0, start - 2), start),
    removed: before.slice(start, before.length - end),
    added: after.slice(start, after.length - end),
    contextAfter: before.slice(before.length - end, before.length - end + 2)
  }
}

export { editPreview }
