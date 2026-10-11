import { expect, test } from '../fixtures/local-provider.fixture'
import { assistantMessages, composer, sendUserMessage } from '../utils/chat'
import { waitForAppReady } from '../utils/wait-helpers'

test.describe('Persistence across restart', () => {
  test('user reads a partial reply when the connection ends, then failure survives restart', async ({
    app,
    provider
  }, testInfo) => {
    const response = provider.enqueue({
      type: 'text',
      text: 'An unfinished persisted answer.',
      hold: true
    })
    await composer(app.window).fill('Keep this incomplete answer')
    await app.window.getByRole('button', { name: 'Send message' }).click()
    const partial = assistantMessages(app.window).last()
    await expect(partial.getByTestId('answer-content')).toHaveText(
      'An unfinished persisted answer.'
    )
    response.close()
    await response.closed
    await expect(app.window.getByRole('alert')).toBeVisible()
    await expect(app.window.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(app.window.getByRole('button', { name: 'Stop response' })).toBeHidden()
    await expect(partial.getByRole('button', { name: 'Copy message' })).toHaveCount(0)
    const title = await app.window.locator('.conversation-row__title').first().innerText()
    await app.relaunch()
    await app.window
      .getByLabel('Sidebar', { exact: true })
      .getByRole('button', { name: title, exact: true })
      .click()
    await expect(app.window.getByRole('alert')).toBeVisible()
    await expect(app.window.getByRole('button', { name: 'Try again' })).toBeVisible()
    const restored = assistantMessages(app.window).last()
    await expect(restored.getByTestId('answer-content')).toHaveText(
      'An unfinished persisted answer.'
    )
    await expect(restored.getByRole('button', { name: 'Copy message' })).toHaveCount(0)
    await expect(
      app.window.getByTestId('answer-content').filter({ hasText: 'Keep this incomplete answer' })
    ).toHaveCount(1)
    await app.window.screenshot({ path: testInfo.outputPath('partial-eof-failed-restored.png') })
  })

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
