import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme } from 'electron'
import * as z from 'zod'

import { AppearancePreferenceSchema } from '@shared/data/schemas/preference'
import { ThemePreferencesSchema } from '@shared/data/schemas/theme'
import type { DataFor } from '@shared/data/types'
import { IpcChannel } from '@shared/IpcChannel'
import { resolveCodeTheme, type Appearance, type CodeThemeId } from '@shared/theme/theme-registry'

import { writeJsonAtomically } from '../data/atomic-json'

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
  private appearancePreference: AppearancePreference = 'system'
  private themePreferences: ThemePreferences = defaultThemePreferences

  constructor(
    private readonly dependencies: PreferenceServiceDependencies = electronDependencies
  ) {}

  async initialize(): Promise<void> {
    this.themePreferences = await this.readThemePreferences()
    this.appearancePreference = this.themePreferences.appearancePreference
    this.dependencies.nativeTheme.themeSource = this.appearancePreference
    this.dependencies.nativeTheme.on('updated', this.broadcastResolvedAppearance)
  }

  getAppearancePreference(): AppearancePreference {
    return this.appearancePreference
  }

  getResolvedAppearance(): Appearance {
    return this.dependencies.nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }

  async setAppearancePreference(preference: AppearancePreference): Promise<Appearance> {
    await this.setThemePreferences({ ...this.themePreferences, appearancePreference: preference })
    return this.getResolvedAppearance()
  }

  getThemeState(): ThemeState {
    const appearance = this.getResolvedAppearance()
    return {
      ...this.themePreferences,
      activeThemePreset:
        appearance === 'light'
          ? this.themePreferences.themePresetLight
          : this.themePreferences.themePresetDark,
      appearance,
      shikiThemes: {
        dark: resolveCodeTheme(
          'dark',
          this.themePreferences.codeThemeDark,
          this.themePreferences.themePresetDark
        ),
        light: resolveCodeTheme(
          'light',
          this.themePreferences.codeThemeLight,
          this.themePreferences.themePresetLight
        )
      }
    }
  }

  async setThemePreferences(preferences: ThemePreferences): Promise<ThemeState> {
    await this.writeThemePreferences(preferences)
    this.themePreferences = preferences
    const preference = preferences.appearancePreference
    this.appearancePreference = preference
    this.dependencies.nativeTheme.themeSource = preference
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

  private async writeThemePreferences(preferences: ThemePreferences): Promise<void> {
    await writeJsonAtomically(this.preferencesPath, preferences)
  }

  private get preferencesPath(): string {
    return join(this.dependencies.getUserDataPath(), 'preferences.json')
  }
}

export { PreferenceService }
