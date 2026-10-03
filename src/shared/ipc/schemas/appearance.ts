import { IpcChannel } from '../../IpcChannel'
import type { IpcMethod } from '../contracts'
import type { DataFor } from '../../data/types'

type Appearance = DataFor<'appearance'>
type ThemePreferences = DataFor<'themePreferences'>
type ThemeState = DataFor<'themeState'>

interface AppearanceAPI {
  getPreference: IpcMethod<IpcChannel.Appearance_GetPreference>
  getResolvedAppearance: IpcMethod<IpcChannel.Appearance_GetResolved>
  setPreference: IpcMethod<IpcChannel.Appearance_SetPreference>
  getThemeState: IpcMethod<IpcChannel.Appearance_GetThemeState>
  setThemePreferences: IpcMethod<IpcChannel.Appearance_SetThemePreferences>
  onAppearanceChange: (listener: (appearance: Appearance) => void) => () => void
  onThemeChange: (listener: (theme: ThemeState) => void) => () => void
}
export { type AppearanceAPI, type ThemePreferences, type ThemeState }
