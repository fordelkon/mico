import { describe, expect, it } from 'vitest'

import { normalizeCapabilities, resolveThinkingSelection } from '../reasoning'

describe('reasoning capabilities', () => {
  it('keeps known distinct controls and falls back to default for a stale selection', () => {
    const capabilities = normalizeCapabilities(['none', 'low', 'low', 'unknown'], 'low')

    expect(capabilities).toEqual({
      availability: 'supported',
      selectableEfforts: ['none', 'low'],
      defaultEffort: 'low'
    })
    expect(resolveThinkingSelection('high', capabilities)).toBe('default')
  })

  it('does not expose a menu capability for a fixed one-value model', () => {
    expect(normalizeCapabilities(['high'], 'high')).toBeNull()
  })

  it('turns off thinking for a model with no reasoning capabilities', () => {
    expect(resolveThinkingSelection('xhigh', null)).toBe('none')
  })
})
