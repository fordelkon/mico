import { expect, test } from '../fixtures/electron.fixture'
import { waitForAppReady } from '../utils/wait-helpers'

test.describe('App launch', () => {
  test('user starts the app when it launches, then the window opens with the composer ready', async ({
    electronApp,
    mainWindow
  }, testInfo) => {
    await waitForAppReady(mainWindow)
    const capabilities = await mainWindow.evaluate(() => ({
      genericElectronBridge: 'electron' in window,
      platform: document.querySelector('[data-platform]')?.getAttribute('data-platform')
    }))
    expect(capabilities).toEqual({ genericElectronBridge: false, platform: process.platform })

    const bounds = await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      return window?.getBounds()
    })

    // The OS clamps the window into the visible work area, which can be
    // smaller than the created size on CI runners; a reasonable size only
    // needs to prove the window actually opened.
    expect(bounds?.width).toBeGreaterThan(400)
    expect(bounds?.height).toBeGreaterThan(300)
    await expect(mainWindow.getByRole('textbox', { name: 'Message' })).toBeVisible()

    const screenshotPath = testInfo.outputPath('launch-composer.png')
    await mainWindow.screenshot({ path: screenshotPath })
    await testInfo.attach('launch-composer', { path: screenshotPath })
  })

  test('user resizes the window very narrow when composing, then the send control stays reachable', async ({
    electronApp,
    mainWindow
  }, testInfo) => {
    await waitForAppReady(mainWindow)

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(360, 720)
    })
    await expect(mainWindow.getByRole('textbox', { name: 'Message' })).toBeVisible()
    // Without a configured model the send button carries the guidance label.
    const send = mainWindow.getByRole('button', { name: /Send message|Select an enabled model/ })
    await expect(send).toBeVisible()

    // The real window width may be clamped by the app's minimum size; assert
    // the actual footer geometry instead of a nominal threshold.
    const geometry = await send.evaluate((button) => {
      const footer = button.parentElement
      if (!footer) throw new Error('The composer footer is missing.')
      const footerBounds = footer.getBoundingClientRect()
      const buttonBounds = button.getBoundingClientRect()
      return {
        buttonVisible: buttonBounds.width > 0 && buttonBounds.height > 0,
        buttonInsideFooter:
          buttonBounds.right <= footerBounds.right + 1 &&
          buttonBounds.left >= footerBounds.left - 1,
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
      }
    })
    expect(geometry).toEqual({
      buttonVisible: true,
      buttonInsideFooter: true,
      pageOverflow: false
    })

    const screenshotPath = testInfo.outputPath('narrow-composer.png')
    await mainWindow.screenshot({ path: screenshotPath })
    await testInfo.attach('narrow-composer', { path: screenshotPath })
  })
})

test('user types a multiline draft when pressing Shift+Enter, then the unsent draft stays editable', async ({
  mainWindow
}) => {
  await waitForAppReady(mainWindow)
  const composer = mainWindow.getByRole('textbox', { name: 'Message' })
  await composer.fill('First line')
  await composer.press('Shift+Enter')
  await composer.pressSequentially('Second line')
  await expect(composer).toHaveValue('First line\nSecond line')
  await expect(composer).toBeFocused()
  await expect(mainWindow.locator('[data-slot="message"]')).toHaveCount(0)
})

test('user keeps control focus when typing on a footer button, then the composer does not steal it', async ({
  mainWindow
}) => {
  await waitForAppReady(mainWindow)
  const attachments = mainWindow.getByRole('button', { name: 'Add attachment' })
  await attachments.focus()
  await mainWindow.keyboard.press('a')

  await expect(attachments).toBeFocused()
  await expect(mainWindow.getByRole('textbox', { name: 'Message' })).not.toBeFocused()
})
