const ESCAPE_CODE = 27
const BELL_CODE = 7
const CSI_CODE = 155

function skipCsi(text: string, start: number): number {
  let index = start
  while (index < text.length) {
    const code = text.charCodeAt(index)
    index += 1
    if (code >= 0x40 && code <= 0x7e) break
  }
  return index
}

function skipControlString(text: string, start: number): number {
  let index = start
  while (index < text.length) {
    const code = text.charCodeAt(index)
    if (code === BELL_CODE) return index + 1
    if (code === ESCAPE_CODE && text.charAt(index + 1) === '\\') return index + 2
    index += 1
  }
  return index
}

/** Remove terminal control strings and styling in one pass for streamed output. */
function stripTerminalControlSequences(text: string): string {
  let clean = ''
  let index = 0
  while (index < text.length) {
    const code = text.charCodeAt(index)
    if (code === CSI_CODE) {
      index = skipCsi(text, index + 1)
      continue
    }
    if (code !== ESCAPE_CODE) {
      clean += text.charAt(index)
      index += 1
      continue
    }

    const marker = text.charAt(index + 1)
    if (marker === '[') {
      index = skipCsi(text, index + 2)
    } else if (']PX^_'.includes(marker)) {
      index = skipControlString(text, index + 2)
    } else if (marker === '(' || marker === ')') {
      index = Math.min(text.length, index + 3)
    } else {
      index = Math.min(text.length, index + 2)
    }
  }
  return clean
}

export { stripTerminalControlSequences }
