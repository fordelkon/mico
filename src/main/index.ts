import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
  type BrowserWindowConstructorOptions,
  type IpcMainInvokeEvent
} from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../build/icon.png?asset'
import trayTemplateIcon from '../../build/tray-template.png?asset'
import windowsIcon from '../../build/icons/icon.ico?asset'
import {
  APPEARANCE_GET_PREFERENCE_CHANNEL,
  APPEARANCE_GET_RESOLVED_CHANNEL,
  APPEARANCE_SET_PREFERENCE_CHANNEL,
  isAppearancePreference
} from '../shared/appearance'
import {
  WINDOW_CLOSE_CHANNEL,
  WINDOW_FULLSCREEN_CHANGED_CHANNEL,
  WINDOW_IS_FULLSCREEN_CHANNEL,
  WINDOW_IS_MAXIMIZED_CHANNEL,
  WINDOW_MAXIMIZE_CHANNEL,
  WINDOW_MAXIMIZED_CHANGED_CHANNEL,
  WINDOW_MINIMIZE_CHANNEL,
  WINDOW_TOGGLE_FULLSCREEN_CHANNEL,
  WINDOW_UNMAXIMIZE_CHANNEL
} from '../shared/window-controls'
import { PreferenceService } from './services/preference-service'

const preferenceService = new PreferenceService()
let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let isQuitting = false

function isTrustedRendererUrl(url: string): boolean {
  try {
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      return new URL(url).origin === new URL(process.env['ELECTRON_RENDERER_URL']).origin
    }

    return url === pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
  } catch {
    return false
  }
}

function getCallingWindow(event: IpcMainInvokeEvent): BrowserWindow {
  if (
    event.senderFrame !== event.sender.mainFrame ||
    !isTrustedRendererUrl(event.senderFrame.url)
  ) {
    throw new Error('Untrusted window control sender')
  }

  const window = BrowserWindow.fromWebContents(event.sender)

  if (!window) {
    throw new Error('Window not found')
  }

  return window
}

function registerWindowControlHandlers(): void {
  ipcMain.handle(WINDOW_CLOSE_CHANNEL, (event) => getCallingWindow(event).close())
  ipcMain.handle(WINDOW_IS_FULLSCREEN_CHANNEL, (event) => getCallingWindow(event).isFullScreen())
  ipcMain.handle(WINDOW_IS_MAXIMIZED_CHANNEL, (event) => getCallingWindow(event).isMaximized())
  ipcMain.handle(WINDOW_MAXIMIZE_CHANNEL, (event) => getCallingWindow(event).maximize())
  ipcMain.handle(WINDOW_MINIMIZE_CHANNEL, (event) => getCallingWindow(event).minimize())
  ipcMain.handle(WINDOW_TOGGLE_FULLSCREEN_CHANNEL, (event) => {
    const window = getCallingWindow(event)
    window.setFullScreen(!window.isFullScreen())
  })
  ipcMain.handle(WINDOW_UNMAXIMIZE_CHANNEL, (event) => getCallingWindow(event).unmaximize())
}

function registerAppearanceHandlers(): void {
  ipcMain.handle(APPEARANCE_GET_PREFERENCE_CHANNEL, (event) => {
    getCallingWindow(event)
    return preferenceService.getAppearancePreference()
  })
  ipcMain.handle(APPEARANCE_GET_RESOLVED_CHANNEL, (event) => {
    getCallingWindow(event)
    return preferenceService.getResolvedAppearance()
  })
  ipcMain.handle(APPEARANCE_SET_PREFERENCE_CHANNEL, async (event, preference: string) => {
    getCallingWindow(event)
    if (!isAppearancePreference(preference)) throw new Error('Invalid appearance preference')

    return preferenceService.setAppearancePreference(preference)
  })
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }

  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createTray(): void {
  const trayIcon = nativeImage.createFromPath(
    process.platform === 'darwin'
      ? trayTemplateIcon
      : process.platform === 'win32'
        ? windowsIcon
        : icon
  )

  if (process.platform === 'darwin') trayIcon.setTemplateImage(true)
  if (trayIcon.isEmpty()) {
    console.error('Tray icon could not be loaded')
    return
  }

  tray = new Tray(trayIcon)
  tray.setToolTip('Mico')
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Mico', click: showMainWindow },
    {
      label: 'Quit Mico',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  if (process.platform === 'darwin') {
    tray.on('right-click', () => tray?.popUpContextMenu(contextMenu))
  } else {
    tray.setContextMenu(contextMenu)
  }
  tray.on('click', showMainWindow)
}

function createWindow(): void {
  const windowOptions: BrowserWindowConstructorOptions = {
    width: 900,
    height: 670,
    minWidth: 800,
    minHeight: 600,
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
  mainWindow = window

  window.on('close', (event) => {
    if (isQuitting || !tray || tray.isDestroyed()) return

    event.preventDefault()
    window.hide()
  })

  if (process.platform === 'darwin') {
    window.setWindowButtonVisibility(false)
  }

  window.on('enter-full-screen', () => {
    window.webContents.send(WINDOW_FULLSCREEN_CHANGED_CHANNEL, true)
  })
  window.on('leave-full-screen', () => {
    window.webContents.send(WINDOW_FULLSCREEN_CHANGED_CHANNEL, false)
  })
  window.on('maximize', () => {
    window.webContents.send(WINDOW_MAXIMIZED_CHANGED_CHANNEL, true)
  })
  window.on('unmaximize', () => {
    window.webContents.send(WINDOW_MAXIMIZED_CHANGED_CHANNEL, false)
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
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

void app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(icon)
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerWindowControlHandlers()
  registerAppearanceHandlers()
  createTray()
  void preferenceService.initialize().then(createWindow)

  app.on('activate', function () {
    showMainWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  tray?.destroy()
  tray = undefined
})
