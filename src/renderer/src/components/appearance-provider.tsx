import * as React from 'react'

import type { DataFor } from '@shared/data/types'

type Appearance = DataFor<'appearance'>
type AppearancePreference = DataFor<'appearancePreference'>
type ThemePreferences = DataFor<'themePreferences'>
type ThemeState = DataFor<'themeState'>

type AppearanceContextValue = {
  appearance: Appearance
  preference: AppearancePreference
  theme: ThemeState
  setPreference: (preference: AppearancePreference) => Promise<void>
  setThemePreferences: (preferences: ThemePreferences) => Promise<void>
}

const defaultTheme: ThemeState = {
  activeThemePreset: 'mico-default',
  appearance: 'light',
  appearancePreference: 'system',
  codeThemeDark: 'auto',
  codeThemeLight: 'auto',
  shikiThemes: { dark: 'github-dark', light: 'github-light' },
  themePresetDark: 'mico-default',
  themePresetLight: 'mico-default'
}
const AppearanceContext = React.createContext<AppearanceContextValue>({
  appearance: 'light',
  preference: 'system',
  setPreference: async () => undefined,
  setThemePreferences: async () => undefined,
  theme: defaultTheme
})

function applyTheme(root: HTMLElement, theme: ThemeState): void {
  root.dataset.appearance = theme.appearance
  root.dataset.themePreset = theme.activeThemePreset
  root.classList.toggle('dark', theme.appearance === 'dark')
  root.style.colorScheme = theme.appearance
}

function AppearanceProvider({ children }: React.PropsWithChildren): React.JSX.Element {
  const [appearance, setAppearance] = React.useState<Appearance>('light')
  const [preference, setPreferenceState] = React.useState<AppearancePreference>('system')
  const [theme, setTheme] = React.useState<ThemeState>(defaultTheme)

  // Subscribe before the initial read completes so a concurrent main-process update is not lost.
  React.useEffect(() => {
    let active = true
    const unsubscribe = window.api.appearance.onAppearanceChange((nextAppearance) => {
      if (active) setAppearance(nextAppearance)
    })
    const unsubscribeTheme = window.api.appearance.onThemeChange((nextTheme) => {
      if (!active) return
      setTheme(nextTheme)
      setAppearance(nextTheme.appearance)
      setPreferenceState(nextTheme.appearancePreference)
    })

    void window.api.appearance.getThemeState().then((nextTheme) => {
      if (!active) return

      setTheme(nextTheme)
      setPreferenceState(nextTheme.appearancePreference)
      setAppearance(nextTheme.appearance)
    })

    return () => {
      active = false
      unsubscribe()
      unsubscribeTheme()
    }
  }, [])

  // Apply before paint to avoid briefly rendering controls in the previous appearance.
  React.useLayoutEffect(() => {
    applyTheme(document.documentElement, theme)
  }, [theme])

  const setPreference = React.useCallback(
    async (nextPreference: AppearancePreference): Promise<void> => {
      setPreferenceState(nextPreference)
      const nextAppearance = await window.api.appearance.setPreference(nextPreference)
      setAppearance(nextAppearance)
    },
    []
  )
  const setThemePreferences = React.useCallback(async (nextPreferences: ThemePreferences) => {
    const nextTheme = await window.api.appearance.setThemePreferences(nextPreferences)
    setTheme(nextTheme)
    setAppearance(nextTheme.appearance)
    setPreferenceState(nextTheme.appearancePreference)
  }, [])

  const value = React.useMemo(
    () => ({ appearance, preference, setPreference, setThemePreferences, theme }),
    [appearance, preference, setPreference, setThemePreferences, theme]
  )

  return <AppearanceContext value={value}>{children}</AppearanceContext>
}

function useAppearance(): AppearanceContextValue {
  return React.useContext(AppearanceContext)
}

export { AppearanceProvider, useAppearance }
