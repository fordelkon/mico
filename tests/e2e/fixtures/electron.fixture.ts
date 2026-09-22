import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, test as base } from '@playwright/test'

export type TestApp = {
  electronApp: ElectronApplication
  window: Page
  /** Close the application and relaunch it against the same userData directory. */
  relaunch: () => Promise<Page>
}

export type ElectronFixtures = {
  app: TestApp
  electronApp: ElectronApplication
  mainWindow: Page
}

/**
 * Launch fixtures for Electron e2e testing. Every test gets an isolated
 * userData directory, so tests never touch real application data and can run
 * beside the installed app. Scenarios that restart the application use
 * `app.relaunch()` and read `app.window` afterwards; the derived
 * `electronApp` and `mainWindow` fixtures are only valid until the restart.
 */
export const test = base.extend<ElectronFixtures>({
  app: async ({}, use) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'mico-e2e-'))
    const launch = async (): Promise<ElectronApplication> =>
      electron.launch({
        // The dot loads the app from the project root using the "main" entry in
        // package.json, which points at the electron-vite build in out/.
        args: ['.'],
        env: {
          ...process.env,
          MICO_USER_DATA_DIR: userDataDir
        },
        timeout: 60_000
      })
    const openWindow = async (electronApplication: ElectronApplication): Promise<Page> => {
      const window = await electronApplication.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      return window
    }

    let electronApp = await launch()
    let window = await openWindow(electronApp)
    const app: TestApp = {
      get electronApp() {
        return electronApp
      },
      get window() {
        return window
      },
      relaunch: async () => {
        await electronApp.close()
        electronApp = await launch()
        window = await openWindow(electronApp)
        return window
      }
    }

    await use(app)

    await electronApp.close()
    await rm(userDataDir, { recursive: true, force: true })
  },

  electronApp: ({ app }, use) => use(app.electronApp),

  mainWindow: ({ app }, use) => use(app.window)
})

export { expect } from '@playwright/test'
