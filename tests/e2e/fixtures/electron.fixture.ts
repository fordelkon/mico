import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test as base } from '@playwright/test'

export type TestApp = {
  electronApp: ElectronApplication
  window: Page
  workspaceDir: string
  /** Relaunch against the same isolated storage without reinitializing preferences. */
  relaunch: () => Promise<Page>
}
export type ElectronFixtures = {
  app: TestApp
  electronApp: ElectronApplication
  mainWindow: Page
}

/** Own native app lifetime, failure evidence, and all per-test filesystem state. */
export const test = base.extend<ElectronFixtures>({
  app: async ({}, use, testInfo) => {
    const directory = await mkdtemp(join(tmpdir(), 'mico-e2e-'))
    const workspaceDir = join(directory, 'project')
    const runtimeErrors: string[] = []
    const traces: string[] = []
    // Traces contain action arguments. Never record real-provider credential entry.
    const recordTrace = testInfo.project.name !== 'real-provider'
    let electronApp: ElectronApplication | undefined
    let window: Page | undefined
    let tracing = false
    const redact = (text: string): string => {
      const key = process.env['MICO_E2E_API_KEY']
      return key ? text.replaceAll(key, '[REDACTED]') : text
    }
    const stopTrace = async (): Promise<void> => {
      if (!electronApp || !tracing) return
      tracing = false
      const path = testInfo.outputPath(`electron-trace-${traces.length}.zip`)
      await electronApp.context().tracing.stop({ path })
      traces.push(path)
    }
    const launch = async (): Promise<Page> => {
      electronApp = await electron.launch({
        args: ['.'],
        env: { ...process.env, MICO_USER_DATA_DIR: join(directory, 'user-data') },
        timeout: 60_000
      })
      window = await electronApp.firstWindow()
      window.on('pageerror', (error) => runtimeErrors.push(redact(error.message)))
      window.on('crash', () => runtimeErrors.push('The Electron renderer crashed.'))
      if (recordTrace) {
        await electronApp.context().tracing.start({ screenshots: true, snapshots: true })
        tracing = true
      }
      await window.waitForLoadState('domcontentloaded')
      return window
    }
    try {
      await mkdir(workspaceDir)
      await launch()
      await use({
        get electronApp() {
          if (!electronApp) throw new Error('The test application is not running.')
          return electronApp
        },
        get window() {
          if (!window) throw new Error('The test application window is unavailable.')
          return window
        },
        workspaceDir,
        relaunch: async () => {
          await stopTrace()
          await electronApp?.close()
          electronApp = undefined
          return launch()
        }
      })
      expect(runtimeErrors, 'Unexpected Electron renderer failures').toEqual([])
    } finally {
      // Evidence failure must never prevent native process and temporary-data cleanup.
      try {
        await stopTrace()
        if (testInfo.status !== testInfo.expectedStatus || runtimeErrors.length) {
          if (window && !window.isClosed()) {
            const screenshot = await window
              .screenshot({ mask: [window.locator('input[type="password"]')] })
              .catch((error: Error) => {
                runtimeErrors.push(`Screenshot capture failed: ${redact(error.message)}`)
                return undefined
              })
            if (screenshot)
              await testInfo.attach('Electron failure', {
                body: screenshot,
                contentType: 'image/png'
              })
          }
          if (!window || window.isClosed())
            runtimeErrors.push('The renderer window closed before evidence capture.')
          for (const path of traces)
            await testInfo.attach('Electron trace', { path, contentType: 'application/zip' })
          if (runtimeErrors.length)
            await testInfo.attach('Renderer errors', {
              body: runtimeErrors.join('\n'),
              contentType: 'text/plain'
            })
        } else {
          for (const path of traces) await rm(path, { force: true })
        }
      } finally {
        try {
          await electronApp?.close()
        } finally {
          await rm(directory, { recursive: true, force: true })
        }
      }
    }
  },
  electronApp: ({ app }, use) => use(app.electronApp),
  mainWindow: ({ app }, use) => use(app.window)
})

export { expect } from '@playwright/test'
