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
  error: string | null
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
  error: null,
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
  const [theme, setTheme] = React.useState<ThemeState>(defaultTheme)
  const [error, setError] = React.useState<string | null>(null)
  const revision = React.useRef(0)

  // Subscribe before the initial read completes so a concurrent main-process update is not lost.
  React.useEffect(() => {
    let active = true
    const initialRevision = revision.current
    const unsubscribeTheme = window.api.appearance.onThemeChange((nextTheme) => {
      if (!active) return
      revision.current += 1
      setTheme(nextTheme)
      setError(null)
    })

    void window.api.appearance.getThemeState().then(
      (nextTheme) => {
        if (active && revision.current === initialRevision) setTheme(nextTheme)
      },
      () => {
        if (active && revision.current === initialRevision)
          setError('Could not load appearance settings. Reopen Mico to try again.')
      }
    )

    return () => {
      active = false
      revision.current += 1
      unsubscribeTheme()
    }
  }, [])

  // Apply before paint to avoid briefly rendering controls in the previous appearance.
  React.useLayoutEffect(() => {
    applyTheme(document.documentElement, theme)
  }, [theme])

  const save = React.useCallback(async (commit: () => Promise<ThemeState>): Promise<void> => {
    const atRevision = ++revision.current
    try {
      const nextTheme = await commit()
      if (revision.current !== atRevision) return
      setTheme(nextTheme)
      setError(null)
    } catch {
      if (revision.current === atRevision)
        setError(
          'Could not save appearance settings. Your previous theme is still active. Try selecting the theme again.'
        )
    }
  }, [])
  const setPreference = React.useCallback(
    (nextPreference: AppearancePreference): Promise<void> =>
      save(() => window.api.appearance.setPreference(nextPreference)),
    [save]
  )
  const setThemePreferences = React.useCallback(
    (nextPreferences: ThemePreferences): Promise<void> =>
      save(() => window.api.appearance.setThemePreferences(nextPreferences)),
    [save]
  )

  const value = React.useMemo(
    () => ({
      appearance: theme.appearance,
      preference: theme.appearancePreference,
      setPreference,
      setThemePreferences,
      theme,
      error
    }),
    [setPreference, setThemePreferences, theme, error]
  )

  return <AppearanceContext value={value}>{children}</AppearanceContext>
}

function useAppearance(): AppearanceContextValue {
  return React.useContext(AppearanceContext)
}

export { AppearanceProvider, useAppearance }
