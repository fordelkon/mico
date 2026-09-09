import * as z from 'zod'

import { AppearancePreferenceSchema, AppearanceSchema } from '../../data/schemas/preference'
import { ThemePreferencesSchema, ThemeStateSchema } from '../../data/schemas/theme'
import type { DataFor } from '../../data/types'
import { defineRoute } from '../define'

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
const appearanceRequestSchemas = {
  'appearance.get-preference': defineRoute({ input: z.void(), output: AppearancePreferenceSchema }),
  'appearance.get-resolved': defineRoute({ input: z.void(), output: AppearanceSchema }),
  'appearance.set-preference': defineRoute({
    input: AppearancePreferenceSchema,
    output: AppearanceSchema
  }),
  'appearance.get-theme-state': defineRoute({ input: z.void(), output: ThemeStateSchema }),
  'appearance.set-theme-preferences': defineRoute({
    input: ThemePreferencesSchema,
    output: ThemeStateSchema
  })
}
export { appearanceRequestSchemas, type AppearanceAPI, type ThemePreferences, type ThemeState }
