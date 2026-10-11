import { expect, test } from '../fixtures/local-provider.fixture'
import { assistantMessages, sendUserMessage } from '../utils/chat'

test('user compacts and cancels context when a conversation is settled, then history stays intact', async ({
  app,
  provider
}, testInfo) => {
  provider.enqueue({ type: 'text', text: 'Original answer.' })
  await sendUserMessage(app.window, 'Original question')
  const row = app.window
    .getByRole('listitem')
    .filter({ has: app.window.getByRole('button', { name: 'E2E conversation', exact: true }) })
  const menu = async () => {
    await row.hover()
    await row.getByRole('button', { name: 'More actions' }).click()
  }
  const summary = provider.enqueue({
    type: 'text',
    text: 'The user asked a question and received an answer.',
    hold: true
  })
  await menu()
  await app.window.getByRole('menuitem', { name: 'Compact context', exact: true }).click()
  await summary.received
  await expect(row.getByLabel('Summarizing conversation')).toHaveAttribute('aria-busy', 'true')
  await expect(row.getByLabel('Summarizing conversation')).not.toHaveAttribute('role', 'status')
  await expect(row.getByLabel('Summarizing conversation')).not.toHaveAttribute('role', 'alert')
  await expect(row.getByLabel('Summarizing conversation')).toBeVisible()
  await app.window.getByRole('button', { name: 'New chat', exact: true }).click()
  await expect(row.getByLabel('Summarizing conversation')).toBeVisible()
  await app.window.screenshot({ path: testInfo.outputPath('summary-pending.png') })
  await menu()
  await expect(
    app.window.getByRole('menuitem', { name: 'Compact context', exact: true })
  ).toBeDisabled()
  await app.window.getByRole('menuitem', { name: 'Cancel summary', exact: true }).click()
  await expect(row.getByLabel('Summarizing conversation')).toBeHidden()
  await row.getByRole('button', { name: 'E2E conversation', exact: true }).click()
  await expect(assistantMessages(app.window)).toHaveCount(1)
  provider.enqueue({ type: 'text', text: 'After cancellation.' })
  await sendUserMessage(app.window, 'Send immediately after cancellation')
  provider.enqueue({ type: 'text', text: '' })
  await menu()
  await app.window.getByRole('menuitem', { name: 'Compact context', exact: true }).click()
  await expect(row.getByRole('alert')).toContainText('empty summary')
  await expect(assistantMessages(app.window)).toHaveCount(2)
  provider.enqueue({ type: 'text', text: 'The questions and answers are summarized.' })
  await menu()
  await app.window.getByRole('menuitem', { name: 'Compact context', exact: true }).click()
  await expect(row.getByRole('status')).toHaveText('Context compacted.')
  await app.window.screenshot({ path: testInfo.outputPath('summary-accepted.png') })
  await row.getByRole('button', { name: 'More actions' }).focus()
  await expect(row.getByRole('button', { name: 'More actions' })).toBeFocused()
  await app.window.keyboard.press('Enter')
  await expect(
    app.window.getByRole('menuitem', { name: 'Compact context', exact: true })
  ).toBeVisible()
  await app.window.keyboard.press('Escape')
  await app.window.getByRole('button', { name: 'Settings', exact: true }).click()
  await app.window.getByRole('button', { name: 'Appearance', exact: true }).click()
  await app.window.getByRole('radio', { name: 'Dark', exact: true }).click()
  await app.window.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(app.window.locator('html')).toHaveClass(/dark/)
  await app.window.screenshot({ path: testInfo.outputPath('summary-dark.png') })
  await menu()
  await app.window.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await app.window.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(row).toHaveCount(0)
})
