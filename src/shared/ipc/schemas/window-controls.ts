import * as z from 'zod'

import { defineRoute } from '../define'

interface WindowControlsAPI {
  close: () => Promise<void>
  isFullScreen: () => Promise<boolean>
  isMaximized: () => Promise<boolean>
  maximize: () => Promise<void>
  minimize: () => Promise<void>
  onFullScreenChange: (listener: (isFullScreen: boolean) => void) => () => void
  onMaximizedChange: (listener: (isMaximized: boolean) => void) => () => void
  onProviderDraftFlush: (listener: () => Promise<void>) => () => void
  toggleFullScreen: () => Promise<void>
  unmaximize: () => Promise<void>
}
const windowControlsRequestSchemas = {
  'window-controls.close': defineRoute({ input: z.void(), output: z.void() }),
  'window-controls.is-fullscreen': defineRoute({ input: z.void(), output: z.boolean() }),
  'window-controls.is-maximized': defineRoute({ input: z.void(), output: z.boolean() }),
  'window-controls.maximize': defineRoute({ input: z.void(), output: z.void() }),
  'window-controls.minimize': defineRoute({ input: z.void(), output: z.void() }),
  'window-controls.toggle-fullscreen': defineRoute({ input: z.void(), output: z.void() }),
  'window-controls.unmaximize': defineRoute({ input: z.void(), output: z.void() })
}
export { windowControlsRequestSchemas, type WindowControlsAPI }
