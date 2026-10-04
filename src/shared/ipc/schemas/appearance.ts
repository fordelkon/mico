import { IpcChannel } from '../../IpcChannel'
import type { IpcMethod } from '../contracts'
import type { DataFor } from '../../data/types'

type ThemePreferences = DataFor<'themePreferences'>
type ThemeState = DataFor<'themeState'>

interface AppearanceAPI {
  setPreference: IpcMethod<IpcChannel.Appearance_SetPreference>
  getThemeState: IpcMethod<IpcChannel.Appearance_GetThemeState>
  setThemePreferences: IpcMethod<IpcChannel.Appearance_SetThemePreferences>
  onThemeChange: (listener: (theme: ThemeState) => void) => () => void
}
export { type AppearanceAPI, type ThemePreferences, type ThemeState }
