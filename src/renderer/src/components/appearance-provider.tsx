import * as React from 'react'

import type { DataFor } from '@shared/data/types'

type Appearance = DataFor<'appearance'>
type AppearancePreference = DataFor<'appearancePreference'>

type AppearanceContextValue = {
  appearance: Appearance
  preference: AppearancePreference
  setPreference: (preference: AppearancePreference) => Promise<void>
}

const AppearanceContext = React.createContext<AppearanceContextValue | null>(null)

function applyAppearance(root: HTMLElement, appearance: Appearance): void {
  root.dataset.appearance = appearance
  root.classList.toggle('dark', appearance === 'dark')
  root.style.colorScheme = appearance
}

function AppearanceProvider({ children }: React.PropsWithChildren): React.JSX.Element {
  const [appearance, setAppearance] = React.useState<Appearance>('light')
  const [preference, setPreferenceState] = React.useState<AppearancePreference>('system')

  // Subscribe before the initial read completes so a concurrent main-process update is not lost.
  React.useEffect(() => {
    let active = true
    const unsubscribe = window.api.appearance.onAppearanceChange((nextAppearance) => {
      if (active) setAppearance(nextAppearance)
    })

    void Promise.all([
      window.api.appearance.getPreference(),
      window.api.appearance.getResolvedAppearance()
    ]).then(([nextPreference, nextAppearance]) => {
      if (!active) return

      setPreferenceState(nextPreference)
      setAppearance(nextAppearance)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  // Apply before paint to avoid briefly rendering controls in the previous appearance.
  React.useLayoutEffect(() => {
    applyAppearance(document.documentElement, appearance)
  }, [appearance])

  const setPreference = React.useCallback(
    async (nextPreference: AppearancePreference): Promise<void> => {
      setPreferenceState(nextPreference)
      const nextAppearance = await window.api.appearance.setPreference(nextPreference)
      setAppearance(nextAppearance)
    },
    []
  )

  const value = React.useMemo(
    () => ({ appearance, preference, setPreference }),
    [appearance, preference, setPreference]
  )

  return <AppearanceContext value={value}>{children}</AppearanceContext>
}

function useAppearance(): AppearanceContextValue {
  const context = React.useContext(AppearanceContext)
  if (!context) throw new Error('useAppearance must be used within AppearanceProvider')
  return context
}

export { AppearanceProvider, useAppearance }
