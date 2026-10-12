import { basename } from 'node:path'

import { expect, test } from '../fixtures/local-provider.fixture'
import { assistantMessages, composer, sendUserMessage } from '../utils/chat'

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

test('user selects a sidebar project when leaving a conversation, then its empty draft and history stay in sync', async ({
  app,
  provider
}, testInfo) => {
  await app.window.emulateMedia({ reducedMotion: 'reduce' })
  const projectName = basename(app.workspaceDir)
  // The folder picker is native; all registration, navigation, and persistence remain real.
  await app.electronApp.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, app.workspaceDir)
  await app.window.getByRole('button', { name: 'Settings', exact: true }).click()
  await app.window.getByRole('button', { name: 'Workspaces', exact: true }).click()
  await app.window.getByRole('button', { name: 'Add Workspace', exact: true }).click()
  await expect(app.window.getByRole('heading', { name: projectName, exact: true })).toBeVisible()
  await app.window.getByRole('button', { name: 'Back', exact: true }).click()

  const sidebar = app.window.getByLabel('Sidebar', { exact: true })
  await composer(app.window).fill('Keep the new-chat draft')
  await sidebar.getByRole('button', { name: projectName, exact: true }).click()
  await expect(app.window.getByLabel('Empty conversation', { exact: true })).toBeVisible()
  await expect(
    app.window.getByRole('button', {
      name: `Workspace: ${projectName} (${app.workspaceDir})`,
      exact: true
    })
  ).toBeVisible()
  await expect(composer(app.window)).toHaveValue('Keep the new-chat draft')
  await expect(composer(app.window)).toBeFocused()
  await expect(sidebar.locator('.conversation-row')).toHaveCount(0)

  provider.enqueue({ type: 'text', text: 'Answer saved in the selected project.' })
  await sendUserMessage(app.window, 'A project conversation')
  const row = sidebar.locator('.conversation-row').first()
  await expect(row.locator('.conversation-row__title')).toHaveText('E2E conversation')
  await row.hover()
  await row.getByRole('button', { name: 'More actions' }).click()
  await app.window.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  await app.window.getByLabel('Conversation title').fill('Project conversation')
  await app.window.getByLabel('Conversation title').press('Enter')
  await expect(
    sidebar.getByRole('button', { name: 'Project conversation', exact: true })
  ).toBeVisible()
  await composer(app.window).fill('Session follow-up draft')

  // Opening the same project leaves its session intact and restores the new-chat surface.
  await sidebar.getByRole('button', { name: projectName, exact: true }).click()
  await expect(app.window.getByLabel('Empty conversation', { exact: true })).toBeVisible()
  await expect(composer(app.window)).toHaveValue('')
  await expect(app.window.getByRole('region', { name: 'Messages', exact: true })).toHaveCount(0)
  await composer(app.window).fill('Project landing draft')
  await sidebar.getByRole('button', { name: 'Default', exact: true }).click()
  await expect(app.window.getByRole('button', { name: /^Workspace: Default/ })).toBeVisible()
  await expect(composer(app.window)).toHaveValue('Project landing draft')
  await sidebar.getByRole('button', { name: projectName, exact: true }).click()
  await expect(
    app.window.getByRole('button', {
      name: `Workspace: ${projectName} (${app.workspaceDir})`,
      exact: true
    })
  ).toBeVisible()
  await app.window.screenshot({ path: testInfo.outputPath('project-empty-state.png') })

  // Disclosure only changes history visibility; clicking a saved session opens its own identity.
  const disclosure = sidebar.getByRole('button', {
    name: `Toggle ${projectName} conversations`,
    exact: true
  })
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
  await disclosure.click()
  await expect(
    sidebar.getByRole('button', { name: 'Project conversation', exact: true })
  ).toBeHidden()
  await expect(composer(app.window)).toHaveValue('Project landing draft')
  await disclosure.click()
  await sidebar.getByRole('button', { name: 'Project conversation', exact: true }).click()
  await expect(app.window.getByLabel('Empty conversation', { exact: true })).toHaveCount(0)
  await expect(assistantMessages(app.window).getByTestId('answer-content').last()).toContainText(
    'Answer saved in the selected project.'
  )
  await expect(composer(app.window)).toHaveValue('Session follow-up draft')
  await app.window.screenshot({ path: testInfo.outputPath('project-session.png') })

  await app.relaunch()
  await app.window
    .getByRole('button', { name: `Toggle ${projectName} conversations`, exact: true })
    .click()
  await app.window.getByRole('button', { name: 'Project conversation', exact: true }).click()
  await expect(assistantMessages(app.window).getByTestId('answer-content').last()).toContainText(
    'Answer saved in the selected project.'
  )
  await expect(
    app.window
      .getByRole('group', { name: 'Conversation workspace', exact: true })
      .getByRole('button', { name: `Workspace: ${projectName} (${app.workspaceDir})`, exact: true })
  ).toBeVisible()
})
