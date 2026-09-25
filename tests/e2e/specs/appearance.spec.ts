import { expect, test } from '../fixtures/electron.fixture'
import { waitForAppReady } from '../utils/wait-helpers'

test('user keeps the dark theme when the app restarts, then it persists', async ({ app }) => {
  await waitForAppReady(app.window)

  await app.window.getByRole('button', { name: 'Settings' }).click()
  await app.window.getByRole('button', { name: 'Appearance' }).click()
  await app.window.getByRole('radio', { name: 'Dark' }).click()
  await expect(app.window.locator('html')).toHaveClass(/dark/)

  const relaunchedWindow = await app.relaunch()
  await waitForAppReady(relaunchedWindow)
  await expect(relaunchedWindow.locator('html')).toHaveClass(/dark/)
})
