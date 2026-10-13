import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  forbidOnly: !!process.env.CI,
  reporter: [['html', { outputFolder: '../../playwright-report/ui', open: 'never' }], ['list']],
  outputDir: '../../test-results/ui',
  use: {
    baseURL: 'http://127.0.0.1:6006',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'pnpm storybook --ci --host 127.0.0.1 --exact-port',
    url: 'http://127.0.0.1:6006/iframe.html',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
})
