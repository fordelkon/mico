import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test } from '../fixtures/local-provider.fixture'
import { assistantMessages, composer, sendUserMessage } from '../utils/chat'

// The only native stub is the OS folder picker; the selected directory is real.
test('user asks for a file when a workspace is selected, then the file and tool transcript survive restart', async ({
  app,
  provider
}) => {
  await app.electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, app.workspaceDir)
  await app.window.getByRole('button', { name: /^Workspace:|^Choose workspace$/ }).click()
  await app.window.getByRole('button', { name: 'Add workspace', exact: true }).click()
  await expect(app.window.getByRole('button', { name: /^Workspace: project/ })).toBeVisible()
  await app.window.getByRole('textbox', { name: 'Search workspaces' }).press('Escape')
  await expect(app.window.getByRole('textbox', { name: 'Search workspaces' })).toBeHidden()

  provider.enqueue({
    type: 'tool',
    name: 'write',
    id: 'write-artifact',
    input: { path: 'result.txt', content: 'MICO_TOOL_RESULT' }
  })
  const followup = provider.enqueue({
    type: 'text',
    text: 'Created result.txt in the workspace.',
    hold: true
  })
  await composer(app.window).fill('Create result.txt in this workspace.')
  await app.window.getByRole('button', { name: 'Send message' }).click()
  const request = await followup.received
  expect(request.messages).toContainEqual(
    expect.objectContaining({
      role: 'tool',
      tool_call_id: 'write-artifact',
      content: 'Created result.txt.'
    })
  )
  expect(await readFile(join(app.workspaceDir, 'result.txt'), 'utf8')).toBe('MICO_TOOL_RESULT')
  followup.finish()
  const reply = assistantMessages(app.window).last()
  await expect(reply.getByRole('button', { name: 'Copy message' })).toBeAttached()
  await expect(app.window.locator('.conversation-row__title')).toHaveText('E2E conversation')

  await app.relaunch()
  await app.window
    .getByLabel('Sidebar', { exact: true })
    .getByRole('button', { name: 'E2E conversation', exact: true })
    .click()
  await app.window.getByRole('button', { name: 'Agent activity: 1 tool call', exact: true }).click()
  await app.window.getByRole('button', { name: 'Write result.txt Created', exact: true }).click()
  await expect(app.window.getByText('File created', { exact: true })).toBeVisible()
  await expect(assistantMessages(app.window).last().getByTestId('answer-content')).toHaveText(
    'Created result.txt in the workspace.'
  )
  expect(await readFile(join(app.workspaceDir, 'result.txt'), 'utf8')).toBe('MICO_TOOL_RESULT')
})

test('user sees a failed file read when the tool cannot find it, then the error is inspectable', async ({
  app,
  provider
}) => {
  provider.enqueue({
    type: 'tool',
    name: 'read',
    id: 'missing-file',
    input: { path: 'missing-e2e-file.txt' }
  })
  provider.enqueue({ type: 'text', text: 'The file could not be read.' })
  await sendUserMessage(app.window, 'Read the missing file.')
  const activity = app.window.getByRole('button', {
    name: 'Agent activity: 1 tool call · 1 failed',
    exact: true
  })
  await expect(activity).toBeVisible()
  // A live group stays open; reopen only when restored/mounted as historical content.
  if ((await activity.getAttribute('aria-expanded')) === 'false') await activity.click()
  await expect(
    app.window.getByRole('button', { name: /Read missing-e2e-file.txt Failed/ })
  ).toBeVisible()
  await expect(app.window.locator('.agent-activity__error')).toContainText(
    /missing-e2e-file|exist|ENOENT/i
  )
})
