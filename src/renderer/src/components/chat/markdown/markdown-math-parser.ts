import katex from 'katex'

const TOKEN_PREFIX = '\uE000MICO_MATH:'
const TOKEN_SUFFIX = '\uE001'
const MATH_LINK_HREF = '#mico-math'
const MATH_ENVIRONMENT = /^\\begin\{([A-Za-z*]+)\}/
const DISPLAY_ENVIRONMENTS = new Set([
  'align',
  'align*',
  'equation',
  'equation*',
  'gather',
  'gather*',
  'multline',
  'multline*'
])

type MarkdownMathParserCache = {
  source: string
  result: string
}

type MarkdownMath = {
  display: boolean
  formula: string
}

function createMarkdownMathParserCache(): MarkdownMathParserCache {
  return { source: '', result: '' }
}

function encodeFormula(formula: string): string {
  const bytes = new TextEncoder().encode(formula)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function decodeFormula(encoded: string): string | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(encoded)) return null

  const parts = encoded.match(/.{2}/g)
  if (!parts) return null

  const bytes = new Uint8Array(parts.map((part) => Number.parseInt(part, 16)))
  try {
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

function toMathLink(formula: string, display: boolean): string {
  const token = `${TOKEN_PREFIX}${display ? 'block' : 'inline'}:${encodeFormula(formula)}${TOKEN_SUFFIX}`
  return `[${token}](${MATH_LINK_HREF})`
}

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    slashCount += 1
  }
  return slashCount % 2 === 1
}

function findUnescaped(source: string, needle: string, from: number): number {
  let cursor = source.indexOf(needle, from)
  while (cursor !== -1 && isEscaped(source, cursor)) {
    cursor = source.indexOf(needle, cursor + needle.length)
  }
  return cursor
}

function findClosingDollar(source: string, from: number): number {
  for (let cursor = from; cursor < source.length; cursor += 1) {
    if (source[cursor] !== '$' || isEscaped(source, cursor)) continue
    if (source[cursor - 1] === '$' || source[cursor + 1] === '$') continue
    return cursor
  }
  return -1
}

function isQualifiedSingleDollar(formula: string, source: string, closeIndex: number): boolean {
  if (!formula || formula.trim() !== formula || /[\r\n]/.test(formula)) return false
  if (/^[A-Za-z_][A-Za-z\d_]*$/.test(formula)) return false
  if (/^\d+(?:\.\d+)?$/.test(formula)) return false
  if (/^\d+(?:\.\d+)?\s*[-–—]\s*$/.test(formula) && /\d/.test(source[closeIndex + 1] ?? '')) {
    return false
  }

  return /\\[A-Za-z]+|\^|_|[=+*/<>]|[()[\]{}]/.test(formula)
}

function findFence(source: string, index: number): { marker: string; end: number } | null {
  if (index > 0 && source[index - 1] !== '\n') return null

  const match = /^(?: {0,3})(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(source.slice(index))
  if (!match) return null

  return { marker: match[1], end: index + match[0].length }
}

function isFenceClose(source: string, index: number, marker: string): number | null {
  if (index > 0 && source[index - 1] !== '\n') return null

  const match = /^(?: {0,3})(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(source.slice(index))
  if (!match || match[1][0] !== marker[0] || match[1].length < marker.length) return null

  return index + match[0].length
}

function skipInlineCode(source: string, index: number): number {
  let length = 1
  while (source[index + length] === '`') length += 1

  const delimiter = '`'.repeat(length)
  const close = source.indexOf(delimiter, index + length)
  return close === -1 ? source.length : close + length
}

function parseMathToken(token: string): MarkdownMath | null {
  const match = new RegExp(`^${TOKEN_PREFIX}(inline|block):([0-9a-f]+)${TOKEN_SUFFIX}$`, 'i').exec(
    token
  )
  if (!match) return null

  const formula = decodeFormula(match[2])
  return formula === null ? null : { display: match[1] === 'block', formula }
}

function decodeMarkdownMath(token: string): MarkdownMath | null {
  return parseMathToken(token)
}

function renderMarkdownMath(formula: string, display: boolean): string {
  return katex.renderToString(formula, {
    displayMode: display,
    output: 'htmlAndMathml',
    strict: 'warn',
    throwOnError: false,
    trust: false
  })
}

function prepareMarkdownMath(source: string, cache: MarkdownMathParserCache): string {
  if (source === cache.source) return cache.result

  let result = ''
  let cursor = 0
  let fenceMarker: string | null = null

  while (cursor < source.length) {
    if (fenceMarker) {
      const closeEnd = isFenceClose(source, cursor, fenceMarker)
      if (closeEnd) {
        result += source.slice(cursor, closeEnd)
        cursor = closeEnd
        fenceMarker = null
      } else {
        result += source[cursor]
        cursor += 1
      }
      continue
    }

    const fence = findFence(source, cursor)
    if (fence) {
      result += source.slice(cursor, fence.end)
      cursor = fence.end
      fenceMarker = fence.marker
      continue
    }

    if (source[cursor] === '`') {
      const end = skipInlineCode(source, cursor)
      result += source.slice(cursor, end)
      cursor = end
      continue
    }

    if (!isEscaped(source, cursor) && source.startsWith('\\(', cursor)) {
      const close = findUnescaped(source, '\\)', cursor + 2)
      if (close !== -1) {
        const formula = source.slice(cursor + 2, close)
        if (formula) {
          result += toMathLink(formula, false)
          cursor = close + 2
          continue
        }
      }
    }

    if (!isEscaped(source, cursor) && source.startsWith('\\[', cursor)) {
      const close = findUnescaped(source, '\\]', cursor + 2)
      if (close !== -1) {
        const formula = source.slice(cursor + 2, close)
        if (formula) {
          result += toMathLink(formula, true)
          cursor = close + 2
          continue
        }
      }
    }

    if (!isEscaped(source, cursor) && source.startsWith('$$', cursor)) {
      const close = findUnescaped(source, '$$', cursor + 2)
      if (close !== -1) {
        const formula = source.slice(cursor + 2, close)
        if (formula) {
          result += toMathLink(formula, true)
          cursor = close + 2
          continue
        }
      }
    }

    if (!isEscaped(source, cursor) && source[cursor] === '\\') {
      const environment = MATH_ENVIRONMENT.exec(source.slice(cursor))
      if (environment && DISPLAY_ENVIRONMENTS.has(environment[1])) {
        const endMarker = `\\end{${environment[1]}}`
        const close = source.indexOf(endMarker, cursor + environment[0].length)
        if (close !== -1) {
          const end = close + endMarker.length
          result += toMathLink(source.slice(cursor, end), true)
          cursor = end
          continue
        }
      }
    }

    if (!isEscaped(source, cursor) && source[cursor] === '$' && source[cursor + 1] !== '$') {
      const close = findClosingDollar(source, cursor + 1)
      if (close !== -1) {
        const formula = source.slice(cursor + 1, close)
        if (isQualifiedSingleDollar(formula, source, close)) {
          result += toMathLink(formula, false)
          cursor = close + 1
          continue
        }
      }
    }

    result += source[cursor]
    cursor += 1
  }

  cache.source = source
  cache.result = result
  return result
}

export {
  createMarkdownMathParserCache,
  decodeMarkdownMath,
  prepareMarkdownMath,
  renderMarkdownMath,
  type MarkdownMath,
  type MarkdownMathParserCache
}
