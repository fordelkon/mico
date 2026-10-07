import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test } from '../fixtures/local-provider.fixture'
import type { TestApp } from '../fixtures/electron.fixture'
import { assistantMessages, composer, waitForReply } from '../utils/chat'

async function selectWorkspace(app: TestApp): Promise<void> {
  // Only replace the native chooser; registration and filesystem access remain real.
  await app.electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, app.workspaceDir)
  await app.window.getByRole('button', { name: /^Workspace:|^Choose workspace$/ }).click()
  await app.window.getByRole('button', { name: 'Add workspace', exact: true }).click()
  await app.window.getByRole('textbox', { name: 'Search workspaces' }).press('Escape')
}

test('user denies then approves a write when reviewing operations, then only the approved file is created', async ({
  app,
  provider
}, testInfo) => {
  // The scenario spans two turns, an approval roundtrip, and a theme switch;
  // the default timeout only fits the shorter scenarios.
  test.slow()
  await app.window.emulateMedia({ reducedMotion: 'reduce' })
  await selectWorkspace(app)
  provider.enqueue({
    type: 'tool',
    name: 'Write',
    id: 'denied-write',
    input: { file_path: 'denied.txt', content: 'not allowed' }
  })
  provider.enqueue({ type: 'text', text: 'The write was denied.' })
  await composer(app.window).fill('Create denied.txt.')
  await app.window.getByRole('button', { name: 'Send message' }).click()
  const approval = app.window.getByRole('group', { name: 'Approval for Write', exact: true })
  await expect(approval).toBeVisible()
  await expect(approval.getByLabel('Proposed file content')).toHaveText('not allowed')
  await expect(readFile(join(app.workspaceDir, 'denied.txt'), 'utf8')).rejects.toThrow('ENOENT')
  await app.electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(820, 760)
  )
  await app.window.screenshot({ path: testInfo.outputPath('permission-pending.png') })
  await app.window.getByRole('button', { name: 'Settings', exact: true }).click()
  await app.window.getByRole('button', { name: 'Appearance', exact: true }).click()
  await app.window.getByRole('radio', { name: 'Dark', exact: true }).click()
  await app.window.getByRole('button', { name: 'Back', exact: true }).click()
  await app.window.evaluate(() =>
    // Wait only for time-based animations: scroll-driven ones (animation-timeline:
    // scroll()) finish solely when their scroll range completes, so their
    // `finished` promise stays pending while the list rests above the bottom.
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.timeline === document.timeline &&
            animation.effect?.getComputedTiming().iterations !== Infinity
        )
        .map((animation) => animation.finished.catch(() => undefined))
    )
  )
  await expect(approval.getByRole('button', { name: 'Deny', exact: true })).toBeVisible()
  await app.window.screenshot({ path: testInfo.outputPath('permission-pending-dark.png') })
  expect(
    await app.window.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBe(true)
  await approval.getByRole('button', { name: 'Deny', exact: true }).click()
  await waitForReply(app.window, assistantMessages(app.window).last())
  await expect(readFile(join(app.workspaceDir, 'denied.txt'), 'utf8')).rejects.toThrow('ENOENT')

  provider.enqueue({
    type: 'tool',
    name: 'Write',
    id: 'approved-write',
    input: { file_path: 'approved.txt', content: 'approved bytes' }
  })
  provider.enqueue({ type: 'text', text: 'The approved file was created.' })
  await composer(app.window).fill('Create approved.txt.')
  await app.window.getByRole('button', { name: 'Send message' }).click()
  const nextApproval = app.window
    .getByRole('group', { name: 'Approval for Write', exact: true })
    .last()
  await expect(nextApproval.getByLabel('Proposed file content')).toHaveText('approved bytes')
  await expect(nextApproval.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible()
  await nextApproval.getByRole('button', { name: 'Allow once', exact: true }).focus()
  await app.window.keyboard.press('Enter')
  await waitForReply(app.window, assistantMessages(app.window).last())
  expect(await readFile(join(app.workspaceDir, 'approved.txt'), 'utf8')).toBe('approved bytes')
})

test('user stops a pending command when approval is required, then the command never runs', async ({
  app,
  provider
}) => {
  await selectWorkspace(app)
  provider.enqueue({
    type: 'tool',
    name: 'Bash',
    id: 'cancelled-command',
    input: { command: 'echo changed > cancelled.txt' }
  })
  await composer(app.window).fill('Run the command.')
  await app.window.getByRole('button', { name: 'Send message' }).click()
  const approval = app.window.getByRole('group', { name: 'Approval for Bash', exact: true })
  await expect(approval.getByLabel('Command')).toHaveText('echo changed > cancelled.txt')
  await app.window.getByRole('button', { name: 'Stop response' }).click()
  await expect(app.window.getByRole('button', { name: 'Allow once', exact: true })).toBeHidden()
  await expect(readFile(join(app.workspaceDir, 'cancelled.txt'), 'utf8')).rejects.toThrow('ENOENT')
})
