export type Appearance = 'light' | 'dark'
export type AppearancePreference = 'system' | Appearance

export const APPEARANCE_GET_PREFERENCE_CHANNEL = 'appearance:get-preference'
export const APPEARANCE_GET_RESOLVED_CHANNEL = 'appearance:get-resolved'
export const APPEARANCE_SET_PREFERENCE_CHANNEL = 'appearance:set-preference'
export const APPEARANCE_CHANGED_CHANNEL = 'appearance:changed'

export interface AppearanceAPI {
  getPreference: () => Promise<AppearancePreference>
  getResolvedAppearance: () => Promise<Appearance>
  onAppearanceChange: (listener: (appearance: Appearance) => void) => () => void
  setPreference: (preference: AppearancePreference) => Promise<Appearance>
}

export function isAppearancePreference(value: string): value is AppearancePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}
