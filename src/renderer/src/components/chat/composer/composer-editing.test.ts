import { describe, expect, it } from 'vitest'
import { arrowTokenJump, backspaceDeletion, wordBackspaceDeletion } from './composer-editing'
import { tokenizeComposerDraft } from './composer-tokens'

const skillNames = new Set(['review', 'manual'])
const tokens = (draft: string) => tokenizeComposerDraft(draft, skillNames)

describe('backspaceDeletion', () => {
  it('user places the caret inside the leading invocation when editing, then the whole token deletes at once', () => {
    expect(backspaceDeletion(tokens('$review here'), 3)).toEqual({
      start: 0,
      end: 7
    })
    expect(backspaceDeletion(tokens('$review here'), 7)).toEqual({
      start: 0,
      end: 7
    })
  })

  it('user places the caret outside the leading invocation when editing, then the browser deletes one character', () => {
    expect(backspaceDeletion(tokens('$review here'), 0)).toBeNull()
    expect(backspaceDeletion(tokens('$review here'), 9)).toBeNull()
    expect(backspaceDeletion(tokens('plain words'), 5)).toBeNull()
  })
})

describe('wordBackspaceDeletion', () => {
  it('user deletes a word with the caret at the token end when editing, then no "$" fragment stays behind', () => {
    expect(wordBackspaceDeletion('$review here', tokens('$review here'), 7)).toEqual({
      start: 0,
      end: 7
    })
    expect(wordBackspaceDeletion('$rev|iew', tokens('$review'), 4)).toEqual({
      start: 0,
      end: 7
    })
  })

  it('user deletes a word right behind one separator when editing, then the token and separator remove together', () => {
    expect(wordBackspaceDeletion('$review here', tokens('$review here'), 8)).toEqual({
      start: 0,
      end: 8
    })
  })

  it('user deletes a word further from the token when editing, then the browser keeps its own word deletion', () => {
    expect(wordBackspaceDeletion('$review here', tokens('$review here'), 9)).toBeNull()
    expect(wordBackspaceDeletion('$review  ', tokens('$review  '), 9)).toBeNull()
    expect(wordBackspaceDeletion('plain words', tokens('plain words'), 6)).toBeNull()
  })
})

describe('arrowTokenJump', () => {
  it('user moves left inside the leading invocation when editing, then the caret jumps to its start', () => {
    expect(arrowTokenJump(tokens('$review here'), 4, 'left')).toBe(0)
    expect(arrowTokenJump(tokens('$review here'), 7, 'left')).toBe(0)
  })

  it('user moves right inside the leading invocation when editing, then the caret jumps to its end', () => {
    expect(arrowTokenJump(tokens('$review here'), 2, 'right')).toBe(7)
    expect(arrowTokenJump(tokens('$review here'), 0, 'right')).toBe(7)
  })

  it('user moves along the text outside the token when editing, then the caret moves one character', () => {
    expect(arrowTokenJump(tokens('$review here'), 8, 'left')).toBeNull()
    expect(arrowTokenJump(tokens('$review here'), 7, 'right')).toBeNull()
    expect(arrowTokenJump(tokens('plain words'), 4, 'left')).toBeNull()
  })
})
