import { describe, expect, it } from 'vitest'
import { projectComposerDraft } from './composer-draft-model'
import type { ChatComposerDraft } from './composer-draft-types'

const empty: ChatComposerDraft = {
  text: '',
  documents: [],
  pasteTokens: [],
  isSending: false,
  sendError: null
}

describe('composer draft projection', () => {
  it('user edits a captured label into command text when drafting, then its damaged range remains one token', () => {
    const draft: ChatComposerDraft = {
      ...empty,
      text: '/compact edited label',
      pasteTokens: [
        {
          id: 'captured',
          text: 'original payload',
          displayText: '[Pasted 16 chars · abc123]',
          start: 0,
          end: 21,
          state: 'damaged',
          damagedTexts: ['/compact edited label']
        }
      ]
    }
    const projection = projectComposerDraft(draft, new Set())
    expect(projection.tokens).toEqual([{ start: 0, end: 21, kind: 'paste' }])
    expect(projection.pasteIssue).toContain('was edited')
    expect(projection.canRepairPaste).toBe(true)
  })
})
