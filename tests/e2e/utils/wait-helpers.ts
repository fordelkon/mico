import type { Page } from '@playwright/test'

/**
 * Wait for Mico's first paint to settle: the React root is attached and the
 * chat composer — the entry surface of the default route — is interactive.
 */
export async function waitForAppReady(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForSelector('#root', { state: 'attached', timeout })
  await page.getByRole('textbox').waitFor({ state: 'visible', timeout })
}
