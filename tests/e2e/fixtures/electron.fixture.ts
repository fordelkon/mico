import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, test as base } from '@playwright/test'

export type ElectronFixtures = {
  electronApp: ElectronApplication
  mainWindow: Page
}

/**
 * Launch fixtures for Electron e2e testing. Every test gets an isolated
 * userData directory, so tests never touch real application data and can run
 * beside the installed app.
 */
export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'mico-e2e-'))
    const electronApp = await electron.launch({
      // The dot loads the app from the project root using the "main" entry in
      // package.json, which points at the electron-vite build in out/.
      args: ['.'],
      env: {
        ...process.env,
        MICO_USER_DATA_DIR: userDataDir
      },
      timeout: 60_000
    })

    await use(electronApp)

    await electronApp.close()
    await rm(userDataDir, { recursive: true, force: true })
  },

  mainWindow: async ({ electronApp }, use) => {
    const mainWindow = await electronApp.firstWindow()
    await mainWindow.waitForLoadState('domcontentloaded')
    await use(mainWindow)
  }
})

export { expect } from '@playwright/test'
