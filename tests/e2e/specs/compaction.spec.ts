import { expect, test } from '../fixtures/local-provider.fixture'
import { assistantMessages, composer, sendUserMessage } from '../utils/chat'

test('user compacts and cancels context when a conversation is settled, then history stays intact', async ({
  app,
  provider
}, testInfo) => {
  provider.enqueue({ type: 'text', text: 'Original answer.' })
  await sendUserMessage(app.window, 'Original question')
  const main = app.window.getByRole('main', { name: 'Main content', exact: true })
  const row = app.window
    .getByRole('listitem')
    .filter({ has: app.window.getByRole('button', { name: 'E2E conversation', exact: true }) })
  await row.hover()
  await row.getByRole('button', { name: 'More actions' }).click()
  await expect(
    app.window.getByRole('menuitem', { name: 'Compact context', exact: true })
  ).toHaveCount(0)
  await expect(
    app.window.getByRole('menuitem', { name: 'Cancel summary', exact: true })
  ).toHaveCount(0)
  await expect(app.window.getByRole('menuitem', { name: 'Rename', exact: true })).toBeVisible()
  await app.window.keyboard.press('Escape')
  await row
    .getByRole('button', { name: 'E2E conversation', exact: true })
    .click({ button: 'right' })
  await expect(
    app.window.getByRole('menuitem', { name: 'Compact context', exact: true })
  ).toHaveCount(0)
  await expect(
    app.window.getByRole('menuitem', { name: 'Cancel summary', exact: true })
  ).toHaveCount(0)
  await app.window.keyboard.press('Escape')

  const compact = async () => {
    await composer(app.window).fill('/comp')
    await expect(main.getByRole('option', { name: /Compact context/ })).toBeVisible()
    await composer(app.window).press('Tab')
    await expect(composer(app.window)).toHaveValue('/compact ')
    await composer(app.window).press('Enter')
  }
  const summary = provider.enqueue({
    type: 'text',
    text: 'The user asked a question and received an answer.',
    hold: true
  })
  await compact()
  await summary.received
  await expect(main.getByRole('status')).toContainText('Summarizing conversation…')
  await expect(main.getByRole('button', { name: 'Cancel summary', exact: true })).toBeVisible()
  await expect(composer(app.window)).toBeDisabled()
  await expect(row.getByRole('status')).toHaveCount(0)
  await app.window.screenshot({ path: testInfo.outputPath('summary-pending.png') })
  await app.window.getByRole('button', { name: 'New chat', exact: true }).click()
  await expect(main.getByText('Summarizing conversation…')).toHaveCount(0)
  await expect(row.getByRole('status')).toHaveCount(0)
  await row.getByRole('button', { name: 'E2E conversation', exact: true }).click()
  await expect(main.getByRole('status')).toContainText('Summarizing conversation…')
  await main.getByRole('button', { name: 'Cancel summary', exact: true }).click()
  await summary.closed
  await expect(main.getByRole('status')).toContainText('Summary cancelled.')
  await expect(main.getByRole('alert')).toHaveCount(0)
  await expect(assistantMessages(app.window)).toHaveCount(1)
  provider.enqueue({ type: 'text', text: 'After cancellation.' })
  await sendUserMessage(app.window, 'Send immediately after cancellation')
  provider.enqueue({ type: 'text', text: '' })
  await compact()
  await expect(main.getByRole('alert')).toContainText('empty summary')
  await expect(assistantMessages(app.window)).toHaveCount(2)
  provider.enqueue({ type: 'text', text: 'The questions and answers are summarized.' })
  await compact()
  await expect(main.getByRole('status')).toContainText('Context compacted.')
  await expect(main.getByRole('button', { name: 'Dismiss', exact: true })).toBeVisible()
  await expect(assistantMessages(app.window)).toHaveCount(2)
  await expect(row.getByRole('status')).toHaveCount(0)
  await expect(row.getByRole('alert')).toHaveCount(0)
  await app.window.screenshot({ path: testInfo.outputPath('summary-accepted.png') })
  await app.window.getByRole('button', { name: 'Settings', exact: true }).click()
  await app.window.getByRole('button', { name: 'Appearance', exact: true }).click()
  await app.window.getByRole('radio', { name: 'Dark', exact: true }).click()
  await app.window.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(app.window.locator('html')).toHaveClass(/dark/)
  await expect(main.getByRole('status')).toContainText('Context compacted.')
  await expect(app.window.locator('html')).not.toHaveAttribute('data-navigation-transition')
  await app.window.screenshot({ path: testInfo.outputPath('summary-dark.png') })
  await main.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(main.getByRole('status')).toHaveCount(0)
  await row.hover()
  await row.getByRole('button', { name: 'More actions' }).click()
  await app.window.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await app.window.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(row).toHaveCount(0)
})
