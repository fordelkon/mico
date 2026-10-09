import { defineConfig } from '@playwright/test'

/**
 * Playwright configuration for Electron e2e testing.
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests/e2e/specs',

  timeout: 60_000,

  expect: { timeout: 10_000 },

  // Electron apps run sequentially to avoid userData and single-instance conflicts.
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,

  retries: process.env.CI ? 2 : 0,

  reporter: [['html', { outputFolder: 'playwright-report' }], ['list']],

  globalSetup: './tests/e2e/global-setup.ts',

  outputDir: './test-results',

  use: {
    // The Electron fixture owns evidence for its externally launched context.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000
  },

  projects: [
    {
      name: 'electron',
      testMatch: '**/*.spec.ts',
      testIgnore: ['**/real-provider.spec.ts', '**/packaged-smoke.spec.ts']
    },
    ...(process.env['MICO_E2E_EXECUTABLE_PATH']
      ? [{ name: 'packaged-smoke', testMatch: '**/packaged-smoke.spec.ts' }]
      : []),
    {
      name: 'real-provider',
      testMatch: '**/real-provider.spec.ts'
    }
  ]
})
