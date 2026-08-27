import { ElectronAPI } from '@electron-toolkit/preload'

import type { AppearanceAPI } from '../shared/appearance'
import type { WindowControlsAPI } from '../shared/window-controls'

interface MicoAPI {
  appearance: AppearanceAPI
  windowControls: WindowControlsAPI
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: MicoAPI
  }
}
