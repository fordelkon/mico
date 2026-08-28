import { ElectronAPI } from '@electron-toolkit/preload'

import type { WindowApiType } from './api'

declare global {
  interface Window {
    electron: ElectronAPI
    api: WindowApiType
  }
}
