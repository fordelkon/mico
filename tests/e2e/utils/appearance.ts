import type { Page } from '@playwright/test'

/** Switch the application theme through Settings → Appearance and return to the chat page. */
export async function selectTheme(page: Page, theme: 'Dark' | 'Light'): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByRole('radio', { name: theme, exact: true }).click()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
}
