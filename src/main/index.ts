import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  type BrowserWindowConstructorOptions,
  type IpcMainInvokeEvent
} from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
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

function createWindow(): void {
  // Create the browser window.
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
  } else if (process.platform === 'darwin') {
    windowOptions.acceptFirstMouse = true
    windowOptions.titleBarStyle = 'hidden'
  } else if (process.platform === 'linux') {
    windowOptions.icon = icon
  }
  const mainWindow = new BrowserWindow(windowOptions)

  if (process.platform === 'darwin') {
    mainWindow.setWindowButtonVisibility(false)
  }

  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send(WINDOW_FULLSCREEN_CHANGED_CHANNEL, true)
  })
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send(WINDOW_FULLSCREEN_CHANGED_CHANNEL, false)
  })
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send(WINDOW_MAXIMIZED_CHANGED_CHANNEL, true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send(WINDOW_MAXIMIZED_CHANGED_CHANNEL, false)
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
void app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))
  registerWindowControlHandlers()
  registerAppearanceHandlers()
  void preferenceService.initialize().then(createWindow)

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
