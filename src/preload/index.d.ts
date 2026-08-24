import { ElectronAPI } from '@electron-toolkit/preload'

import type { WindowControlsAPI } from '../shared/window-controls'

interface MicoAPI {
  windowControls: WindowControlsAPI
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: MicoAPI
  }
}
