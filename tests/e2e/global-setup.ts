import 'dotenv/config'

import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Global setup for Playwright e2e tests. Loading the repository .env here
 * (gitignored) makes the optional real-provider credentials persistent for
 * local runs; real environment variables still win over .env entries. Fails
 * fast with an actionable message when the application build is missing
 * instead of failing each test with an obscure Electron launch error.
 */
export default function globalSetup(): void {
  if (!existsSync(join(process.cwd(), 'out', 'main', 'index.js'))) {
    throw new Error('The application build is missing. Run "pnpm build" before "pnpm test:e2e".')
  }
}
