import type { Page } from '@playwright/test'

import { expect } from '../fixtures/electron.fixture'

/** Select a model in the composer and wait for the selection to land. */
export async function selectChatModel(page: Page, modelId: string): Promise<void> {
  await page.getByRole('button', { name: 'Select model' }).click()
  await page.getByRole('option', { name: modelId }).click()
  await expect(page.getByRole('textbox', { name: 'Search models' })).toBeHidden()
  await expect(page.getByRole('button', { name: modelId })).toBeVisible()
}

/**
 * Send a message and wait for the assistant turn to complete: a second
 * message appears and streams to non-empty text.
 */
export async function sendUserMessage(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox').click()
  await page.getByRole('textbox').fill(text)
  await page.getByRole('button', { name: 'Send message' }).click()

  const messages = page.locator('[data-slot="message"]')
  await expect(messages).toHaveCount(2)
  await expect(messages.last()).toContainText(/\S/)
}
