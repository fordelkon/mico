import { expect, test } from '../fixtures/electron.fixture'
import { sendUserMessage, selectChatModel } from '../utils/chat'
import { configureRealProvider, isConfigured, realEndpoints } from '../utils/real-provider'

test.describe('Conversation management', () => {
  test('user renames and deletes a conversation when managing the sidebar, then the list updates', async ({
    app
  }) => {
    const endpoint = realEndpoints.find(({ id }) => id === 'openai')!
    test.skip(!isConfigured(endpoint), 'Set MICO_E2E_API_KEY with the openai base URL and model')

    await configureRealProvider(app.window, endpoint)
    await selectChatModel(app.window, endpoint.modelId)
    await sendUserMessage(app.window, 'Reply with the single word: OK.')

    const row = app.window.locator('.conversation-row').first()
    await expect(row).toBeVisible()
    await row.hover()
    await row.getByRole('button', { name: 'More actions' }).click()
    await app.window.getByRole('menuitem', { name: 'Rename' }).click()

    const titleInput = app.window.getByLabel('Conversation title')
    await titleInput.fill('Renamed conversation')
    await titleInput.press('Enter')
    await expect(app.window.getByRole('button', { name: 'Renamed conversation' })).toBeVisible()

    await row.hover()
    await row.getByRole('button', { name: 'More actions' }).click()
    await app.window.getByRole('menuitem', { name: 'Delete' }).click()
    await app.window.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()

    await expect(app.window.locator('.conversation-row')).toHaveCount(0)
    await expect(app.window.getByText('Clear History')).toBeVisible()
  })
})
