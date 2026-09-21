import { describe, expect, it } from 'vitest'

import { normalizeCapabilities, resolveThinkingSelection } from '../reasoning'

describe('reasoning capabilities', () => {
  it('user gets clean thinking options when the list is dirty, then stale picks revert', () => {
    const capabilities = normalizeCapabilities(['none', 'low', 'low', 'unknown'], 'low')

    expect(capabilities).toEqual({
      availability: 'supported',
      selectableEfforts: ['none', 'low'],
      defaultEffort: 'low'
    })
    expect(resolveThinkingSelection('high', capabilities)).toBe('default')
  })

  it('user gets no thinking menu when a model has one value, then the result is null', () => {
    expect(normalizeCapabilities(['high'], 'high')).toBeNull()
  })

  it('user gets no thinking when capabilities are missing, then the selection is none', () => {
    expect(resolveThinkingSelection('xhigh', null)).toBe('none')
  })
})
