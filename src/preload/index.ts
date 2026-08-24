import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

import {
  WINDOW_CLOSE_CHANNEL,
  WINDOW_FULLSCREEN_CHANGED_CHANNEL,
  WINDOW_IS_FULLSCREEN_CHANNEL,
  WINDOW_IS_MAXIMIZED_CHANNEL,
  WINDOW_MAXIMIZE_CHANNEL,
  WINDOW_MAXIMIZED_CHANGED_CHANNEL,
  WINDOW_MINIMIZE_CHANNEL,
  WINDOW_TOGGLE_FULLSCREEN_CHANNEL,
  WINDOW_UNMAXIMIZE_CHANNEL,
  type WindowControlsAPI
} from '../shared/window-controls'

// Custom APIs for renderer
const windowControls: WindowControlsAPI = {
  close: () => ipcRenderer.invoke(WINDOW_CLOSE_CHANNEL),
  isFullScreen: () => ipcRenderer.invoke(WINDOW_IS_FULLSCREEN_CHANNEL),
  isMaximized: () => ipcRenderer.invoke(WINDOW_IS_MAXIMIZED_CHANNEL),
  maximize: () => ipcRenderer.invoke(WINDOW_MAXIMIZE_CHANNEL),
  minimize: () => ipcRenderer.invoke(WINDOW_MINIMIZE_CHANNEL),
  onFullScreenChange: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, isFullScreen: boolean): void => {
      listener(isFullScreen)
    }

    ipcRenderer.on(WINDOW_FULLSCREEN_CHANGED_CHANNEL, wrappedListener)

    return () => ipcRenderer.removeListener(WINDOW_FULLSCREEN_CHANGED_CHANNEL, wrappedListener)
  },
  onMaximizedChange: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, isMaximized: boolean): void => {
      listener(isMaximized)
    }

    ipcRenderer.on(WINDOW_MAXIMIZED_CHANGED_CHANNEL, wrappedListener)

    return () => ipcRenderer.removeListener(WINDOW_MAXIMIZED_CHANGED_CHANNEL, wrappedListener)
  },
  toggleFullScreen: () => ipcRenderer.invoke(WINDOW_TOGGLE_FULLSCREEN_CHANNEL),
  unmaximize: () => ipcRenderer.invoke(WINDOW_UNMAXIMIZE_CHANNEL)
}

const api = { windowControls }

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
