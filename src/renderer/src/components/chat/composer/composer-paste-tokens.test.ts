import { describe, expect, it } from 'vitest'

import type { ComposerPasteToken } from './draft/composer-draft-types'
import {
  createPasteToken,
  expandPasteTokens,
  pasteClipboardText,
  pasteTokenIssue,
  reconcilePasteTokens,
  restorePasteToken
} from './composer-paste-tokens'

const token = (
  overrides: Partial<ComposerPasteToken> & Pick<ComposerPasteToken, 'displayText' | 'text'>
): ComposerPasteToken => ({
  id: crypto.randomUUID(),
  start: 0,
  end: overrides.displayText.length,
  state: 'active',
  damagedTexts: [],
  ...overrides
})

const label = (suffix: string, chars: number): string =>
  `[Pasted ${chars.toLocaleString('en-US')} chars · ${suffix}]`

describe('reconcilePasteTokens', () => {
  it('user undoes and redoes two same-length pastes when labels differ only by ID, then each label keeps its own payload', () => {
    // Same character count, different payloads: only the unique ID in the
    // label can tell the two tokens apart after native undo/redo.
    const first = token({ displayText: label('aaa111', 2_000), text: 'first'.repeat(400) })
    const second = token({
      displayText: label('bbb222', 2_000),
      text: 'second'.repeat(334),
      start: first.displayText.length + 1,
      end: first.displayText.length + 1 + label('bbb222', 2_000).length
    })
    const both = `${first.displayText} ${second.displayText}`
    const afterDelete = reconcilePasteTokens(both, '', [first, second])
    expect(afterDelete.map(({ state }) => state)).toEqual(['retired', 'retired'])

    // One undo restores both labels in a single value change.
    const restored = reconcilePasteTokens('', both, afterDelete)
    expect(restored.map(({ state, start }) => [state, start])).toEqual([
      ['active', 0],
      ['active', first.displayText.length + 1]
    ])
    expect(expandPasteTokens(both, restored)).toBe(`${first.text} ${second.text}`)

    // A second undo round restores only one: the other stays retired and the
    // exact label still cannot attach to the wrong payload.
    const oneBack = reconcilePasteTokens('', first.displayText, afterDelete)
    expect(oneBack.map(({ state }) => state)).toEqual(['active', 'retired'])
    expect(expandPasteTokens(first.displayText, oneBack)).toBe(first.text)
  })

  it('user deletes a paste token when editing, then undo restores it and a broken label turns damaged', () => {
    const displayText = label('ccc333', 1_500)
    const original = token({ displayText, text: 'payload-'.repeat(200) })
    const deleted = reconcilePasteTokens(displayText, '', [original])
    expect(deleted[0]).toMatchObject({ state: 'retired', text: 'payload-'.repeat(200) })
    expect(reconcilePasteTokens('', displayText, deleted)[0]).toMatchObject({ state: 'active' })

    const broken = `${displayText.slice(0, 3)}x${displayText.slice(4)}`
    const damaged = reconcilePasteTokens(displayText, broken, [original])
    expect(damaged[0]).toMatchObject({ state: 'damaged' })
    expect(pasteTokenIssue(broken, damaged)).toMatch(/was edited/)
    // Undoing the damage restores the exact label and the payload.
    expect(reconcilePasteTokens(broken, displayText, damaged)[0]).toMatchObject({
      state: 'active',
      start: 0
    })
  })

  it('user replaces a whole label with other text when editing, then the token retires until the exact label returns', () => {
    const displayText = label('ddd444', 1_200)
    const original = token({ displayText, text: 'p'.repeat(1_200) })
    const replaced = reconcilePasteTokens(`go ${displayText} now`, 'go scratch now', [
      { ...original, start: 3, end: 3 + displayText.length }
    ])
    expect(replaced[0]).toMatchObject({ state: 'retired' })
    // Ordinary replacement text is not a token: sending is not blocked, and
    // retyping the exact unique label re-associates the retired payload.
    expect(pasteTokenIssue('go scratch now', replaced)).toBeNull()
    expect(
      reconcilePasteTokens('go scratch now', `go ${displayText} now`, replaced)[0]
    ).toMatchObject({ state: 'active', start: 3 })
  })

  it('user types text containing a damaged fragment when editing, then no phantom token revives', () => {
    const displayText = label('eee555', 1_000)
    const original = token({ displayText, text: 'e'.repeat(1_000) })
    // A damaged token keeps its broken variant; a retired token remembers the
    // fragment it once held.
    const damaged = reconcilePasteTokens(displayText, `${displayText.slice(0, 3)}x`, [original])
    expect(damaged[0]).toMatchObject({ state: 'damaged' })
    const retired = reconcilePasteTokens(`${displayText.slice(0, 3)}x`, '', damaged)
    expect(retired[0]).toMatchObject({ state: 'retired' })

    // The short fragment appearing in unrelated message text must neither
    // revive the retired token nor flag the draft.
    const ordinary = 'the summary x ends here'
    const observed = reconcilePasteTokens('', ordinary, retired)
    expect(observed[0]).toMatchObject({ state: 'retired' })
    expect(pasteTokenIssue(ordinary, observed)).toBeNull()
    // The token's own broken label returning at its range still restores the
    // damaged association for repair.
    const broken = `${displayText.slice(0, 3)}x${displayText.slice(4)}`
    const knownDamage = reconcilePasteTokens(displayText, broken, [original])
    const removedDamage = reconcilePasteTokens(broken, '', knownDamage)
    expect(reconcilePasteTokens('', broken, removedDamage)[0]).toMatchObject({
      state: 'damaged',
      start: 0
    })
  })

  it('user types an orphan label with no captured payload when drafting, then sending is blocked with guidance', () => {
    expect(pasteTokenIssue('report [Pasted 9 chars · dead00] attached', [])).toMatch(
      /has no original text/
    )
    expect(pasteTokenIssue('no tokens here', [])).toBeNull()
    // Ordinary prose that merely starts like a label is not an orphan.
    expect(pasteTokenIssue('[Pasted below the chart', [])).toBeNull()
  })

  it('user edits text around a token when drafting, then the token range follows the text', () => {
    const displayText = label('eee555', 1_000)
    const original = token({
      displayText,
      text: 'e'.repeat(1_000),
      start: 4,
      end: 4 + displayText.length
    })
    const shifted = reconcilePasteTokens(`see ${displayText} ok`, `see! ${displayText} ok`, [
      original
    ])
    expect(shifted[0]).toMatchObject({
      state: 'active',
      start: 5,
      end: 5 + displayText.length
    })
  })
})

describe('createPasteToken', () => {
  it('user pastes twice with equal lengths when drafting, then the labels never collide', () => {
    const existing: ComposerPasteToken[] = []
    const first = createPasteToken('a'.repeat(2_000), existing, 0)
    existing.push(first)
    const second = createPasteToken('b'.repeat(2_000), existing, first.end + 1)
    expect(first.displayText).not.toBe(second.displayText)
    expect(second.displayText).toBe(`[Pasted 2,000 chars · ${second.displayText.slice(-7, -1)}]`)
  })
})

describe('restorePasteToken', () => {
  it('user repairs a damaged token when drafting, then the exact label replaces the broken text', () => {
    const displayText = label('fff666', 1_100)
    const damaged = {
      ...token({ displayText, text: 'f'.repeat(1_100) }),
      state: 'damaged' as const
    }
    const broken = `${displayText.slice(0, -1)}x]`
    const value = `go ${broken}`
    const repair = restorePasteToken(value, { ...damaged, start: 3, end: 3 + broken.length })
    expect(repair).toEqual({ start: 3, end: 3 + broken.length })
    expect(`${value.slice(0, 3)}${displayText}${value.slice(3 + broken.length)}`).toBe(
      `go ${displayText}`
    )
  })
})

describe('pasteClipboardText', () => {
  it('user copies a selection that touches tokens when drafting, then every touched payload expands', () => {
    const first = token({ displayText: label('ggg777', 10), text: 'FIRST-PAYLOAD' })
    const second = token({
      displayText: label('hhh888', 10),
      text: 'SECOND-PAYLOAD',
      start: first.end + 1,
      end: first.end + 1 + label('hhh888', 10).length
    })
    const value = `${first.displayText} ${second.displayText}`
    expect(pasteClipboardText(value, [first, second], 0, value.length)).toBe(
      'FIRST-PAYLOAD SECOND-PAYLOAD'
    )
    // A partial selection still expands the token it touches, the same way
    // sending does.
    expect(pasteClipboardText(value, [first, second], 2, 5)).toBe('FIRST-PAYLOAD')
    expect(
      pasteClipboardText(
        value,
        [{ ...first, start: value.length + 1, end: value.length + 2 }],
        0,
        3
      )
    ).toBeNull()
    expect(pasteClipboardText(value, [first, second], 0, 0)).toBeNull()
  })
})
