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

    // The OS clamps the window into the visible work area, which can be
    // smaller than the created size on CI runners; a reasonable size only
    // needs to prove the window actually opened.
    expect(bounds?.width).toBeGreaterThan(400)
    expect(bounds?.height).toBeGreaterThan(300)
    await expect(mainWindow.getByRole('textbox')).toBeVisible()
  })
})

test('user types a multiline draft when pressing Shift+Enter, then the unsent draft stays editable', async ({
  mainWindow
}) => {
  await waitForAppReady(mainWindow)
  const composer = mainWindow.getByRole('textbox')
  await composer.fill('First line')
  await composer.press('Shift+Enter')
  await composer.pressSequentially('Second line')
  await expect(composer).toHaveValue('First line\nSecond line')
  await expect(composer).toBeFocused()
  await expect(mainWindow.locator('[data-slot="message"]')).toHaveCount(0)
})
