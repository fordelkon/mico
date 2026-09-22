import { expect, test } from '../fixtures/electron.fixture'
import { waitForAppReady } from '../utils/wait-helpers'

test.describe('App launch', () => {
  test('user starts the app when it launches, then the window opens with the composer ready', async ({
    electronApp,
    mainWindow
  }) => {
    await waitForAppReady(mainWindow)

    const bounds = await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      return window?.getBounds()
    })

    expect(bounds?.width).toBeGreaterThanOrEqual(1000)
    expect(bounds?.height).toBeGreaterThanOrEqual(800)
    await expect(mainWindow.getByRole('textbox')).toBeVisible()
  })
})
