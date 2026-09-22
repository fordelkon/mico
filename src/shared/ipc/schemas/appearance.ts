import type { DataFor } from '../../data/types'

type Appearance = DataFor<'appearance'>
type AppearancePreference = DataFor<'appearancePreference'>
type ThemePreferences = DataFor<'themePreferences'>
type ThemeState = DataFor<'themeState'>

interface AppearanceAPI {
  getPreference: () => Promise<AppearancePreference>
  getResolvedAppearance: () => Promise<Appearance>
  onAppearanceChange: (listener: (appearance: Appearance) => void) => () => void
  setPreference: (preference: AppearancePreference) => Promise<Appearance>
  getThemeState: () => Promise<ThemeState>
  onThemeChange: (listener: (theme: ThemeState) => void) => () => void
  setThemePreferences: (preferences: ThemePreferences) => Promise<ThemeState>
}
export { type AppearanceAPI, type ThemePreferences, type ThemeState }
