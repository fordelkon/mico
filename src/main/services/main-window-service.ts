import { BrowserWindow, shell, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'

import icon from '../../../build/icon.png?asset'
import windowsIcon from '../../../build/icons/icon.ico?asset'
import { IpcChannel } from '@shared/IpcChannel'
import { registerWindowClosingHandlers } from './window-lifecycle'

class MainWindowService {
  private mainWindow: BrowserWindow | undefined

  private readonly closingWindowIds = new Set<number>()

  constructor(
    private readonly shouldKeepWindowOpen: () => boolean,
    private readonly flushProviderDraft: (window: BrowserWindow) => Promise<void>
  ) {}

  initialize(): void {
    this.createWindow()
  }

  isTrustedRendererUrl(url: string): boolean {
    try {
      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        return new URL(url).origin === new URL(process.env['ELECTRON_RENDERER_URL']).origin
      }

      return url === pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
    } catch {
      return false
    }
  }

  show(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this.createWindow()
      return
    }

    if (this.mainWindow.isMinimized()) this.mainWindow.restore()
    this.mainWindow.show()
    this.mainWindow.focus()
  }

  close(window: BrowserWindow): void {
    window.close()
  }

  isFullscreen(window: BrowserWindow): boolean {
    return window.isFullScreen()
  }

  isMaximized(window: BrowserWindow): boolean {
    return window.isMaximized()
  }

  maximize(window: BrowserWindow): void {
    window.maximize()
  }

  minimize(window: BrowserWindow): void {
    window.minimize()
  }

  toggleFullscreen(window: BrowserWindow): void {
    window.setFullScreen(!window.isFullScreen())
  }

  unmaximize(window: BrowserWindow): void {
    window.unmaximize()
  }

  private createWindow(): void {
    const windowOptions: BrowserWindowConstructorOptions = {
      width: 1000,
      height: 800,
      minWidth: 1000,
      minHeight: 800,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    }
    if (process.platform === 'win32') {
      windowOptions.frame = false
      windowOptions.roundedCorners = true
      windowOptions.icon = windowsIcon
    } else if (process.platform === 'darwin') {
      windowOptions.acceptFirstMouse = true
      windowOptions.titleBarStyle = 'hidden'
    } else if (process.platform === 'linux') {
      windowOptions.icon = icon
    }
    const window = new BrowserWindow(windowOptions)
    this.mainWindow = window
    registerWindowClosingHandlers({
      closingWindowIds: this.closingWindowIds,
      flushProviderDraft: this.flushProviderDraft,
      shouldKeepWindowOpen: this.shouldKeepWindowOpen,
      window
    })

    if (process.platform === 'darwin') {
      window.setWindowButtonVisibility(false)
    }

    window.on('enter-full-screen', () => {
      window.webContents.send(IpcChannel.WindowControls_FullscreenChanged, true)
    })
    window.on('leave-full-screen', () => {
      window.webContents.send(IpcChannel.WindowControls_FullscreenChanged, false)
    })
    window.on('maximize', () => {
      window.webContents.send(IpcChannel.WindowControls_MaximizedChanged, true)
    })
    window.on('unmaximize', () => {
      window.webContents.send(IpcChannel.WindowControls_MaximizedChanged, false)
    })

    window.on('ready-to-show', () => {
      window.show()
    })

    window.webContents.on('will-navigate', (event, url) => {
      if (!this.isTrustedRendererUrl(url)) event.preventDefault()
    })

    window.webContents.setWindowOpenHandler((details) => {
      void shell.openExternal(details.url)
      return { action: 'deny' }
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      void window.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }
}

export { MainWindowService }
