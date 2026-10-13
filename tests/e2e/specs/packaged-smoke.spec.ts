import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test } from '../fixtures/local-provider.fixture'
import { assistantMessages, sendUserMessage } from '../utils/chat'
import { selectWorkspace } from '../utils/workspace'

test('user searches a workspace when using the packaged app, then chat and results survive restart', async ({
  app,
  provider
}, testInfo) => {
  expect(await app.electronApp.evaluate(({ app }) => app.isPackaged)).toBe(true)
  await expect(app.window).toHaveURL(/app\.asar/)
  await writeFile(join(app.workspaceDir, 'packaged-smoke.txt'), 'MICO_PACKAGED_GREP\n')
  await selectWorkspace(app)

  provider.enqueue({
    type: 'tool',
    name: 'Grep',
    id: 'packaged-search',
    input: { output_mode: 'content', pattern: 'MICO_PACKAGED_GREP', glob: '**/*.txt' }
  })
  const answer = provider.enqueue({ type: 'text', text: 'Found the packaged workspace marker.' })
  const prompt = 'Find the marker in packaged-smoke.txt.'
  await sendUserMessage(app.window, prompt)
  const request = await answer.received
  expect(request.messages).toContainEqual(
    expect.objectContaining({
      role: 'tool',
      tool_call_id: 'packaged-search',
      content: expect.stringContaining('packaged-smoke.txt:1:MICO_PACKAGED_GREP')
    })
  )
  await app.window.getByRole('button', { name: /^Grep MICO_PACKAGED_GREP/ }).click()
  await expect(app.window.getByRole('log', { name: 'Search results' })).toContainText(
    'packaged-smoke.txt:1:MICO_PACKAGED_GREP'
  )
  await expect(app.window.locator('.conversation-row__title')).toHaveText('E2E conversation')
  await app.window.screenshot({ path: testInfo.outputPath('packaged-before-restart.png') })

  await app.relaunch()
  expect(await app.electronApp.evaluate(({ app }) => app.isPackaged)).toBe(true)
  const sidebar = app.window.getByLabel('Sidebar', { exact: true })
  const projectToggle = sidebar.getByRole('button', { name: 'Toggle project conversations' })
  if ((await projectToggle.getAttribute('aria-expanded')) === 'false') await projectToggle.click()
  await sidebar.getByRole('button', { name: 'E2E conversation', exact: true }).click()
  await expect(app.window.getByText(prompt, { exact: true })).toBeVisible()
  await expect(assistantMessages(app.window).last().getByTestId('answer-content')).toHaveText(
    'Found the packaged workspace marker.'
  )
  await app.window.getByRole('button', { name: /^Grep MICO_PACKAGED_GREP/ }).click()
  await expect(app.window.getByRole('log', { name: 'Search results' })).toContainText(
    'packaged-smoke.txt:1:MICO_PACKAGED_GREP'
  )
  await app.window.screenshot({ path: testInfo.outputPath('packaged-after-restart.png') })
})
