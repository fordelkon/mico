import { app, Menu, nativeImage, Tray } from 'electron'

import icon from '../../../build/icons/512x512.png?asset'
import trayTemplateIcon from '../../../build/tray-template.png?asset'
import windowsIcon from '../../../build/icons/icon.ico?asset'

interface MainWindowPresenter {
  show: () => void
}

class TrayService {
  private tray: Tray | undefined
  private isQuitting = false

  constructor(private readonly mainWindow: MainWindowPresenter) {}

  initialize(): void {
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

    this.tray = new Tray(trayIcon)
    this.tray.setToolTip('Mico')
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Open Mico', click: () => this.mainWindow.show() },
      {
        label: 'Quit Mico',
        click: () => {
          this.beginQuit()
          app.quit()
        }
      }
    ])

    if (process.platform === 'darwin') {
      this.tray.on('right-click', () => this.tray?.popUpContextMenu(contextMenu))
    } else {
      this.tray.setContextMenu(contextMenu)
    }
    this.tray.on('click', () => this.mainWindow.show())
  }

  beginQuit(): void {
    this.isQuitting = true
  }

  shouldKeepWindowOpen(): boolean {
    return !this.isQuitting && Boolean(this.tray && !this.tray.isDestroyed())
  }

  dispose(): void {
    this.tray?.destroy()
    this.tray = undefined
  }
}

export { TrayService }
