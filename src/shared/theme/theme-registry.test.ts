import { describe, expect, it } from 'vitest'

import { getCodeThemes, getThemePresets, resolveCodeTheme } from './theme-registry'

describe('theme registry', () => {
  it('only exposes presets and code themes that match the requested appearance', () => {
    expect(getThemePresets('dark').map(({ id }) => id)).toContain('tokyo-night')
    expect(getThemePresets('dark').map(({ id }) => id)).not.toContain('one-nord-light')
    expect(getCodeThemes('light')).toContain('github-light')
    expect(getCodeThemes('light')).not.toContain('github-dark')
  })

  it('uses the selected preset when code highlighting follows it', () => {
    expect(resolveCodeTheme('dark', 'auto', 'tokyo-night')).toBe('tokyo-night')
  })

  it('falls back to the selected preset when an override targets the other appearance', () => {
    expect(resolveCodeTheme('dark', 'github-light', 'tokyo-night')).toBe('tokyo-night')
  })
})
