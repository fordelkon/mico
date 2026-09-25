import { expect, test } from '../fixtures/local-provider.fixture'
import { sendUserMessage } from '../utils/chat'
import { waitForAppReady } from '../utils/wait-helpers'

test.describe('Persistence across restart', () => {
  test('user sees their conversation when the app restarts, then the transcript persists', async ({
    app,
    provider
  }) => {
    provider.enqueue({ type: 'text', text: 'A complete persisted answer.' })
    const prompt = 'Reply with the single word: OK.'
    await sendUserMessage(app.window, prompt)

    const rowTitle = app.window.locator('.conversation-row__title').first()
    await expect(rowTitle).toBeVisible()
    await expect(rowTitle).toHaveText('E2E conversation')
    const title = 'E2E conversation'

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
    await expect(messages.last().getByTestId('answer-content')).toHaveText(
      'A complete persisted answer.'
    )
    await expect(messages.last().getByRole('button', { name: 'Copy message' })).toBeAttached()
  })
})
