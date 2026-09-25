import { expect, type Locator, type Page } from '@playwright/test'

/** Select a model in the composer and wait for the selection to land. */
export async function selectChatModel(page: Page, modelId: string): Promise<void> {
  await page.getByRole('button', { name: 'Select model' }).click()
  await page.getByRole('option', { name: modelId }).click()
  await expect(page.getByRole('textbox', { name: 'Search models' })).toBeHidden()
  await expect(page.getByRole('button', { name: modelId })).toBeVisible()
}

/** The composer lives in the main chat surface, outside floating search dialogs. */
export function composer(page: Page): Locator {
  return page.getByRole('main', { name: 'Main content', exact: true }).getByRole('textbox')
}

export function assistantMessages(page: Page): Locator {
  return page
    .getByRole('region', { name: 'Messages', exact: true })
    .locator('[data-slot="message"][data-align="start"]')
}

/** Wait for a successful final answer, not reasoning/tool labels or the first token. */
export async function waitForReply(page: Page, reply: Locator): Promise<void> {
  await expect(reply.getByTestId('answer-content').last()).toContainText(/\S/)
  await expect(reply.getByRole('button', { name: 'Copy message' })).toBeAttached()
  await expect(page.getByRole('button', { name: 'Stop response' })).toBeHidden()
  await expect(composer(page)).toBeEditable()
}

/** Send another turn and wait for its new assistant message to finish. */
export async function sendUserMessage(page: Page, text: string): Promise<Locator> {
  const previousCount = await assistantMessages(page).count()
  await composer(page).fill(text)
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(assistantMessages(page)).toHaveCount(previousCount + 1)
  const reply = assistantMessages(page).nth(previousCount)
  await waitForReply(page, reply)
  return reply
}
