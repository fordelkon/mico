import { describe, expect, it } from 'vitest'

import { getCodeThemes, getThemePresets, resolveCodeTheme } from './theme-registry'

describe('theme registry', () => {
  it('user sees only appearance-matching themes when listing, then the rest drop out', () => {
    const darkPresetIds = getThemePresets('dark').map(({ id }) => id)
    expect(darkPresetIds).toContain('tokyo-night')
    expect(darkPresetIds).not.toContain('one-nord-light')
    expect(getCodeThemes('light')).toContain('github-light')
    expect(getCodeThemes('light')).not.toContain('github-dark')
  })

  it('user sees the preset used when the code theme is auto, then highlighting matches', () => {
    expect(resolveCodeTheme('dark', 'auto', 'tokyo-night')).toBe('tokyo-night')
  })

  it('user keeps the preset when overrides target another appearance, then it applies', () => {
    expect(resolveCodeTheme('dark', 'github-light', 'tokyo-night')).toBe('tokyo-night')
  })
})
