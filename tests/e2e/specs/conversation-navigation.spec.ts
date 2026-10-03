import { expect, test } from '../fixtures/local-provider.fixture'
import { sendUserMessage } from '../utils/chat'

test('user opens a chat from settings search when a workspace is renamed, then navigation shows its new name', async ({
  app,
  provider
}) => {
  provider.enqueue({ type: 'text', text: 'Saved in the default workspace.' })
  await sendUserMessage(app.window, 'Save this conversation')
  await expect(
    app.window.getByRole('button', { name: 'E2E conversation', exact: true })
  ).toBeVisible()

  await app.window.getByRole('button', { name: 'Settings', exact: true }).click()
  await app.window.getByRole('button', { name: 'Workspaces', exact: true }).click()
  await app.window.getByRole('button', { name: 'Rename Default', exact: true }).click()
  await app.window.getByRole('textbox', { name: 'Workspace name' }).fill('Renamed workspace')
  await app.window.getByRole('textbox', { name: 'Workspace name' }).press('Enter')
  await expect(
    app.window.getByRole('heading', { name: 'Renamed workspace', exact: true })
  ).toBeVisible()

  await app.window.getByRole('button', { name: 'Search threads', exact: true }).click()
  await app.window.getByRole('combobox').fill('E2E conversation')
  await app.window.getByRole('combobox').press('Enter')

  await expect(
    app.window.getByRole('button', { name: 'Toggle Renamed workspace conversations', exact: true })
  ).toBeVisible()
  await expect(
    app.window.getByRole('button', { name: 'E2E conversation', exact: true })
  ).toBeVisible()
  await expect(app.window.locator('.chat-composer')).toBeVisible()
  await expect(
    app.window.getByRole('button', { name: /^Workspace: Renamed workspace/ })
  ).toBeVisible()
})
