import { describe, expect, it } from 'vitest'

import { resolveThinkingSelection } from '../index'

describe('reasoning capabilities', () => {
  it.each([
    ['low', 'low'],
    ['high', 'default']
  ] as const)(
    'user chooses %s when capabilities offer none and low, then selection resolves to %s',
    (selection, expected) => {
      expect(
        resolveThinkingSelection(selection, {
          availability: 'supported',
          selectableEfforts: ['none', 'low'],
          defaultEffort: 'low'
        })
      ).toBe(expected)
    }
  )

  it('user gets no thinking when capabilities are missing, then the selection is none', () => {
    expect(resolveThinkingSelection('xhigh', null)).toBe('none')
  })
})
