import type { WindowApiType } from './api'

declare global {
  interface Window {
    api: WindowApiType
  }
}
