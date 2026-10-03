import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme } from 'electron'
import * as z from 'zod'

import { AppearancePreferenceSchema } from '@shared/data/schemas/preference'
import { ThemePreferencesSchema } from '@shared/data/schemas/theme'
import type { DataFor } from '@shared/data/types'
import { IpcChannel } from '@shared/IpcChannel'
import { resolveCodeTheme, type Appearance, type CodeThemeId } from '@shared/theme/theme-registry'

import { JsonDocument } from '../data/atomic-json'

type AppearancePreference = DataFor<'appearancePreference'>
type ThemePreferences = DataFor<'themePreferences'>
type ThemeState = DataFor<'themeState'>
type NativeThemeAdapter = {
  on: (event: 'updated', listener: () => void) => void
  shouldUseDarkColors: boolean
  themeSource: 'dark' | 'light' | 'system'
}
type PreferenceServiceDependencies = {
  getUserDataPath: () => string
  getWindows: () => readonly BrowserWindow[]
  nativeTheme: NativeThemeAdapter
}

const defaultThemePreferences: ThemePreferences = {
  appearancePreference: 'system',
  codeThemeDark: 'auto',
  codeThemeLight: 'auto',
  themePresetDark: 'mico-default',
  themePresetLight: 'mico-default'
}
const LegacyPreferenceSchema = z.object({ appearance: AppearancePreferenceSchema })
const LegacyThemePreferencesSchema = z.object({
  appearancePreference: AppearancePreferenceSchema,
  codeThemeDark: z.string(),
  codeThemeLight: z.string(),
  themePresetDark: z.string(),
  themePresetLight: z.string()
})
const electronDependencies: PreferenceServiceDependencies = {
  getUserDataPath: () => app.getPath('userData'),
  getWindows: () => BrowserWindow.getAllWindows(),
  nativeTheme
}

function migrateCodeThemeId(value: string, appearance: Appearance): CodeThemeId {
  const legacyThemeIds = {
    catppuccin: { dark: 'catppuccin-mocha', light: 'catppuccin-latte' },
    github: { dark: 'github-dark', light: 'github-light' },
    gruvbox: { dark: 'gruvbox-dark-medium', light: 'gruvbox-light-medium' },
    material: { dark: 'material-theme-palenight', light: 'material-theme-lighter' },
    'rose-pine': { dark: 'rose-pine-moon', light: 'rose-pine-dawn' },
    solarized: { dark: 'solarized-dark', light: 'solarized-light' },
    vitesse: { dark: 'vitesse-dark', light: 'vitesse-light' }
  } as const

  if (value === 'auto' || value === 'dracula' || value === 'monokai' || value === 'one-dark-pro') {
    return value
  }

  // SAFETY: the lookup only indexes the fixed legacy migration table above.
  return legacyThemeIds[value as keyof typeof legacyThemeIds]?.[appearance] ?? 'auto'
}

class PreferenceService {
  private document: JsonDocument<ThemePreferences> | undefined

  private get themePreferences(): ThemePreferences {
    return this.document?.value ?? defaultThemePreferences
  }

  constructor(
    private readonly dependencies: PreferenceServiceDependencies = electronDependencies
  ) {}

  async initialize(): Promise<void> {
    this.document = new JsonDocument(this.preferencesPath, await this.readThemePreferences())
    this.dependencies.nativeTheme.themeSource = this.themePreferences.appearancePreference
    this.dependencies.nativeTheme.on('updated', this.broadcastResolvedAppearance)
  }

  getAppearancePreference(): AppearancePreference {
    return this.themePreferences.appearancePreference
  }

  getResolvedAppearance(): Appearance {
    return this.dependencies.nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }

  async setAppearancePreference(preference: AppearancePreference): Promise<Appearance> {
    await this.updatePreferences((current) => ({ ...current, appearancePreference: preference }))
    return this.getResolvedAppearance()
  }

  getThemeState(): ThemeState {
    const appearance = this.getResolvedAppearance()
    const preferences = this.themePreferences
    return {
      ...preferences,
      activeThemePreset:
        appearance === 'light' ? preferences.themePresetLight : preferences.themePresetDark,
      appearance,
      shikiThemes: {
        dark: resolveCodeTheme('dark', preferences.codeThemeDark, preferences.themePresetDark),
        light: resolveCodeTheme('light', preferences.codeThemeLight, preferences.themePresetLight)
      }
    }
  }

  async setThemePreferences(preferences: ThemePreferences): Promise<ThemeState> {
    return this.updatePreferences(() => preferences)
  }

  private async updatePreferences(
    change: (current: ThemePreferences) => ThemePreferences
  ): Promise<ThemeState> {
    if (!this.document) throw new Error('Preferences are not initialized.')
    const committed = await this.document.update(change)
    this.dependencies.nativeTheme.themeSource = committed.appearancePreference
    this.broadcastThemeState()
    return this.getThemeState()
  }

  private readonly broadcastResolvedAppearance = (): void => {
    this.broadcastThemeState()
  }

  private broadcastThemeState(): void {
    const state = this.getThemeState()
    for (const window of this.dependencies.getWindows()) {
      window.webContents.send(IpcChannel.Appearance_Changed, state.appearance)
      window.webContents.send(IpcChannel.Appearance_ThemeChanged, state)
    }
  }

  private async readThemePreferences(): Promise<ThemePreferences> {
    try {
      const contents = await readFile(this.preferencesPath, 'utf8')
      const value: unknown = JSON.parse(contents)
      const parsed = ThemePreferencesSchema.safeParse(value)
      if (parsed.success) return parsed.data
      const legacyThemePreferences = LegacyThemePreferencesSchema.safeParse(value)
      if (legacyThemePreferences.success) {
        const migrated = ThemePreferencesSchema.safeParse({
          ...legacyThemePreferences.data,
          codeThemeDark: migrateCodeThemeId(legacyThemePreferences.data.codeThemeDark, 'dark'),
          codeThemeLight: migrateCodeThemeId(legacyThemePreferences.data.codeThemeLight, 'light')
        })
        if (migrated.success) return migrated.data
      }
      const legacyPreference = LegacyPreferenceSchema.safeParse(value).data?.appearance
      return { ...defaultThemePreferences, appearancePreference: legacyPreference ?? 'system' }
    } catch {
      return defaultThemePreferences
    }
  }

  private get preferencesPath(): string {
    return join(this.dependencies.getUserDataPath(), 'preferences.json')
  }
}

export { PreferenceService }
