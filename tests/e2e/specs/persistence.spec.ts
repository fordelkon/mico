import { expect, test } from '../fixtures/electron.fixture'
import { sendUserMessage, selectChatModel } from '../utils/chat'
import { configureRealProvider, isConfigured, realEndpoints } from '../utils/real-provider'
import { waitForAppReady } from '../utils/wait-helpers'

test.describe('Persistence across restart', () => {
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

  test('user sees their conversation when the app restarts, then the transcript persists', async ({
    app
  }) => {
    const endpoint = realEndpoints.find(({ id }) => id === 'openai')!
    test.skip(!isConfigured(endpoint), 'Set MICO_E2E_API_KEY with the openai base URL and model')

    await configureRealProvider(app.window, endpoint)
    await selectChatModel(app.window, endpoint.modelId)
    const prompt = 'Reply with the single word: OK.'
    await sendUserMessage(app.window, prompt)

    const rowTitle = app.window.locator('.conversation-row__title').first()
    await expect(rowTitle).toBeVisible()
    const title = (await rowTitle.textContent()) ?? ''

    const relaunchedWindow = await app.relaunch()
    await waitForAppReady(relaunchedWindow)
    await expect(relaunchedWindow.locator('.conversation-row__title').first()).toHaveText(title)

    // The title can coincide with a titlebar button's name, so scope the row
    // click to the conversation list inside the sidebar.
    await relaunchedWindow
      .getByLabel('Sidebar', { exact: true })
      .getByRole('button', { name: title })
      .click()
    const messages = relaunchedWindow.locator('[data-slot="message"]')
    await expect(messages).toHaveCount(2)
    await expect(relaunchedWindow.getByText(prompt)).toBeVisible()
    await expect(messages.last()).toContainText(/\S/)
  })
})
