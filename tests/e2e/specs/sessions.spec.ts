import { expect, test } from '../fixtures/local-provider.fixture'
import { sendUserMessage } from '../utils/chat'

test.describe('Conversation management', () => {
  test('user renames and deletes a conversation when managing the sidebar, then the list updates', async ({
    app,
    provider
  }) => {
    provider.enqueue({ type: 'text', text: 'A complete persisted answer.' })
    await sendUserMessage(app.window, 'Reply with the single word: OK.')

    await expect(app.window.locator('.conversation-row__title')).toHaveText('E2E conversation')
    const row = app.window.locator('.conversation-row').first()
    await expect(row).toBeVisible()
    await row.hover()
    await row.getByRole('button', { name: 'More actions' }).click()
    await app.window.getByRole('menuitem', { name: 'Rename' }).click()

    const titleInput = app.window.getByLabel('Conversation title')
    await titleInput.fill('Renamed conversation')
    await titleInput.press('Enter')
    await expect(app.window.getByRole('button', { name: 'Renamed conversation' })).toBeVisible()

    // Keep a second conversation as positive evidence that restart loaded the list.
    await app.window.getByRole('button', { name: 'New chat', exact: true }).click()
    provider.enqueue({ type: 'text', text: 'A retained conversation.' })
    await sendUserMessage(app.window, 'Keep this conversation')
    await expect(app.window.locator('.conversation-row__title')).toHaveCount(2)
    await expect(
      app.window
        .getByLabel('Sidebar', { exact: true })
        .getByRole('button', { name: 'E2E conversation', exact: true })
    ).toBeVisible()

    await app.relaunch()
    await expect(app.window.getByRole('button', { name: 'Renamed conversation' })).toBeVisible()
    const restoredRow = app.window.locator('.conversation-row').filter({
      has: app.window.getByRole('button', { name: 'Renamed conversation', exact: true })
    })
    await restoredRow.hover()
    await restoredRow.getByRole('button', { name: 'More actions' }).click()
    await app.window.getByRole('menuitem', { name: 'Delete' }).click()
    await app.window.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()

    // Role locators briefly exclude the background while the alert dialog closes.
    // Wait for actual row removal, which follows the completed delete IPC call.
    await expect(app.window.locator('.conversation-row')).toHaveCount(1)
    await app.relaunch()
    await expect(
      app.window
        .getByLabel('Sidebar', { exact: true })
        .getByRole('button', { name: 'E2E conversation', exact: true })
    ).toBeVisible()
    await expect(
      app.window.getByRole('button', { name: 'Renamed conversation', exact: true })
    ).toHaveCount(0)
    await expect(app.window.locator('.conversation-row')).toHaveCount(1)
  })
})
