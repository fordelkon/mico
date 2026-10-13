import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures/local-provider.fixture'
import { selectTheme } from '../utils/appearance'
import { assistantMessages, composer, sendUserMessage } from '../utils/chat'
import type { startLocalProvider } from '../utils/local-provider'

async function prepareConversation(
  window: Page,
  provider: Awaited<ReturnType<typeof startLocalProvider>>
): Promise<void> {
  provider.enqueue({ type: 'text', text: 'Original answer.' })
  await sendUserMessage(window, 'Original question')
}

const main = (window: Page) => window.getByRole('main', { name: 'Main content', exact: true })
const conversationRow = (window: Page) =>
  window
    .getByRole('listitem')
    .filter({ has: window.getByRole('button', { name: 'E2E conversation', exact: true }) })

/** Complete the /compact slash command through the composer autocomplete. */
const runCompactCommand = async (window: Page): Promise<void> => {
  await composer(window).fill('/comp')
  await expect(main(window).getByRole('option', { name: /Compact context/ })).toBeVisible()
  await composer(window).press('Tab')
  await expect(composer(window)).toHaveValue('/compact ')
  await composer(window).press('Enter')
}

test('user compacts and cancels context when a conversation is settled, then history stays intact', async ({
  app,
  provider
}, testInfo) => {
  await prepareConversation(app.window, provider)
  const row = conversationRow(app.window)
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

  const summary = provider.enqueue({
    type: 'text',
    text: 'The user asked a question and received an answer.',
    hold: true
  })
  await runCompactCommand(app.window)
  await summary.received
  await expect(main(app.window).getByRole('status')).toContainText('Summarizing conversation…')
  await expect(
    main(app.window).getByRole('button', { name: 'Cancel summary', exact: true })
  ).toBeVisible()
  await expect(composer(app.window)).toBeDisabled()
  await expect(row.getByRole('status')).toHaveCount(0)
  await app.window.screenshot({ path: testInfo.outputPath('summary-pending.png') })
  await app.window.getByRole('button', { name: 'New chat', exact: true }).click()
  await expect(main(app.window).getByText('Summarizing conversation…')).toHaveCount(0)
  await expect(row.getByRole('status')).toHaveCount(0)
  await row.getByRole('button', { name: 'E2E conversation', exact: true }).click()
  await expect(main(app.window).getByRole('status')).toContainText('Summarizing conversation…')
  await main(app.window).getByRole('button', { name: 'Cancel summary', exact: true }).click()
  await summary.closed
  await expect(main(app.window).getByRole('status')).toContainText('Summary cancelled.')
  await expect(main(app.window).getByRole('alert')).toHaveCount(0)
  await expect(assistantMessages(app.window)).toHaveCount(1)
  provider.enqueue({ type: 'text', text: 'After cancellation.' })
  await sendUserMessage(app.window, 'Send immediately after cancellation')
})

test('user runs /compact when the provider returns an empty summary, then the error shows and history is preserved', async ({
  app,
  provider
}) => {
  await prepareConversation(app.window, provider)
  provider.enqueue({ type: 'text', text: '' })
  await runCompactCommand(app.window)
  await expect(main(app.window).getByRole('alert')).toContainText('empty summary')
  await expect(assistantMessages(app.window)).toHaveCount(1)
})

test('user compacts context when the provider summarizes, then the confirmation survives theme changes', async ({
  app,
  provider
}, testInfo) => {
  await prepareConversation(app.window, provider)
  const row = conversationRow(app.window)
  provider.enqueue({ type: 'text', text: 'The questions and answers are summarized.' })
  await runCompactCommand(app.window)
  await expect(main(app.window).getByRole('status')).toContainText('Context compacted.')
  await expect(main(app.window).getByRole('button', { name: 'Dismiss', exact: true })).toBeVisible()
  await expect(assistantMessages(app.window)).toHaveCount(1)
  await expect(row.getByRole('status')).toHaveCount(0)
  await expect(row.getByRole('alert')).toHaveCount(0)
  await app.window.screenshot({ path: testInfo.outputPath('summary-accepted.png') })
  await selectTheme(app.window, 'Dark')
  await expect(app.window.locator('html')).toHaveClass(/dark/)
  await expect(main(app.window).getByRole('status')).toContainText('Context compacted.')
  await expect(app.window.locator('html')).not.toHaveAttribute('data-navigation-transition')
  await app.window.screenshot({ path: testInfo.outputPath('summary-dark.png') })
  await main(app.window).getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(main(app.window).getByRole('status')).toHaveCount(0)
})
