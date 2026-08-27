import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme } from 'electron'

import {
  APPEARANCE_CHANGED_CHANNEL,
  type Appearance,
  type AppearancePreference,
  isAppearancePreference
} from '../../shared/appearance'

class PreferenceService {
  private appearancePreference: AppearancePreference = 'system'

  async initialize(): Promise<void> {
    this.appearancePreference = await this.readAppearancePreference()
    nativeTheme.themeSource = this.appearancePreference
    nativeTheme.on('updated', this.broadcastResolvedAppearance)
  }

  getAppearancePreference(): AppearancePreference {
    return this.appearancePreference
  }

  getResolvedAppearance(): Appearance {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }

  async setAppearancePreference(preference: AppearancePreference): Promise<Appearance> {
    await this.writeAppearancePreference(preference)
    this.appearancePreference = preference
    nativeTheme.themeSource = preference

    const appearance = this.getResolvedAppearance()
    this.broadcastAppearance(appearance)
    return appearance
  }

  private readonly broadcastResolvedAppearance = (): void => {
    this.broadcastAppearance(this.getResolvedAppearance())
  }

  private broadcastAppearance(appearance: Appearance): void {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(APPEARANCE_CHANGED_CHANNEL, appearance)
    }
  }

  private async readAppearancePreference(): Promise<AppearancePreference> {
    try {
      const contents = await readFile(this.preferencesPath, 'utf8')
      const match = /^\s*\{\s*"appearance"\s*:\s*"(system|light|dark)"\s*}\s*$/.exec(
        contents
      )

      return match && isAppearancePreference(match[1]) ? match[1] : 'system'
    } catch {
      return 'system'
    }
  }

  private async writeAppearancePreference(preference: AppearancePreference): Promise<void> {
    await mkdir(app.getPath('userData'), { recursive: true })
    const temporaryPath = `${this.preferencesPath}.tmp`
    await writeFile(temporaryPath, JSON.stringify({ appearance: preference }), 'utf8')
    await rename(temporaryPath, this.preferencesPath)
  }

  private get preferencesPath(): string {
    return join(app.getPath('userData'), 'preferences.json')
  }
}

export { PreferenceService }
