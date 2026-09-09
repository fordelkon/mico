import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PreferenceService } from './preference-service'

type TestNativeTheme = {
  on: (event: 'updated', listener: () => void) => void
  shouldUseDarkColors: boolean
  themeSource: 'dark' | 'light' | 'system'
}
type PersistedPreferences = Record<string, string>

const onNativeThemeUpdated = vi.fn()
const nativeTheme: TestNativeTheme = {
  on: onNativeThemeUpdated,
  shouldUseDarkColors: false,
  themeSource: 'system'
}

async function initializeWithPreferences(preferences: PersistedPreferences): Promise<{
  cleanup: () => Promise<void>
  service: PreferenceService
}> {
  const userDataPath = await mkdtemp(join(tmpdir(), 'mico-theme-preferences-'))
  await writeFile(join(userDataPath, 'preferences.json'), JSON.stringify(preferences), 'utf8')
  const service = new PreferenceService({
    getUserDataPath: () => userDataPath,
    getWindows: () => [],
    nativeTheme
  })
  await service.initialize()

  return { cleanup: () => rm(userDataPath, { force: true, recursive: true }), service }
}

describe('PreferenceService theme preferences', () => {
  beforeEach(() => {
    onNativeThemeUpdated.mockReset()
    nativeTheme.shouldUseDarkColors = true
    nativeTheme.themeSource = 'system'
  })

  it('migrates legacy code theme ids to appearance-specific Shiki themes', async () => {
    const { cleanup, service } = await initializeWithPreferences({
      appearancePreference: 'system',
      codeThemeDark: 'github',
      codeThemeLight: 'material',
      themePresetDark: 'tokyo-night',
      themePresetLight: 'material-lighter'
    })

    try {
      expect(service.getThemeState()).toMatchObject({
        activeThemePreset: 'tokyo-night',
        codeThemeDark: 'github-dark',
        codeThemeLight: 'material-theme-lighter',
        shikiThemes: { dark: 'github-dark', light: 'material-theme-lighter' }
      })
    } finally {
      await cleanup()
    }
  })

  it('returns default preferences when the persisted theme object is invalid', async () => {
    const { cleanup, service } = await initializeWithPreferences({
      appearancePreference: 'dark',
      codeThemeDark: 'not-a-theme'
    })

    try {
      expect(service.getThemeState()).toMatchObject({
        activeThemePreset: 'mico-default',
        appearancePreference: 'system',
        codeThemeDark: 'auto',
        codeThemeLight: 'auto'
      })
    } finally {
      await cleanup()
    }
  })
})
