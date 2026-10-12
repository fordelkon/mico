import { describe, expect, it } from 'vitest'
import { tokenizeComposerDraft } from './composer-tokens'

const skillNames = new Set(['review', 'manual', 'compact'])

describe('tokenizeComposerDraft', () => {
  it.each([
    { draft: '/compact', start: 0 },
    { draft: '/compact hello', start: 0 },
    { draft: '  /compact  ', start: 2 },
    { draft: '\n\t/compact\nhello', start: 2 }
  ])(
    'user types $draft when starting a command, then only /compact is highlighted',
    ({ draft, start }) => {
      expect(tokenizeComposerDraft(draft, skillNames)).toEqual([
        { start, end: start + 8, kind: 'command' }
      ])
    }
  )

  it.each(['/compactx', '/compactify', 'later /compact', '/compact,', '', '   '])(
    'user writes %j when drafting plain text, then no command is highlighted',
    (draft) => {
      expect(tokenizeComposerDraft(draft, skillNames)).toEqual([])
    }
  )

  it.each(['$review'])(
    'user opens the draft with %j when its skill is known, then the whole token is highlighted',
    (draft) => {
      expect(tokenizeComposerDraft(draft, skillNames)).toEqual([
        { start: 0, end: draft.length, kind: 'skill' }
      ])
    }
  )

  it.each([
    '$unknown',
    '$reviews',
    '$Review',
    'prefix$review',
    'path/$review',
    '$review/notes',
    '$review$manual',
    '$',
    // The slash form is plain text now, even when it names a known skill.
    '/skill:review',
    '/skill:unknown',
    '/skill:'
  ])('user writes %j when no $ skill matches, then the word stays plain text', (draft) => {
    expect(tokenizeComposerDraft(draft, skillNames)).toEqual([])
  })

  it.each([
    { draft: 'first $review', highlighted: 'first ' },
    { draft: 'use $review here', highlighted: 'use ' },
    { draft: '/compact $review', highlighted: undefined }
  ])(
    'user mentions %j when writing body words, then only a leading invocation can highlight',
    ({ draft, highlighted }) => {
      expect(tokenizeComposerDraft(draft, skillNames)).toEqual(
        highlighted === undefined ? [{ start: 0, end: 8, kind: 'command' }] : []
      )
    }
  )

  it('user drafts /compact with arguments when the catalog is unavailable, then only /compact highlights', () => {
    expect(tokenizeComposerDraft('/compact $review /skill:manual', new Set())).toEqual([
      { start: 0, end: 8, kind: 'command' }
    ])
  })

  it('user keeps arguments when opening with a known skill, then the arguments stay plain text', () => {
    expect(tokenizeComposerDraft('$review check this', skillNames)).toEqual([
      { start: 0, end: 7, kind: 'skill' }
    ])
    expect(tokenizeComposerDraft('/skill:manual check this', skillNames)).toEqual([])
  })
})
