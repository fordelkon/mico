import type { WindowApiType } from '../../../src/preload/api'

import { expect, test } from '../fixtures/local-provider.fixture'

test('user quits with a pending provider edit when restarting, then the latest URL is restored', async ({
  app,
  provider
}) => {
  await app.window.getByRole('button', { name: 'Settings', exact: true }).click()
  await app.window
    .getByRole('navigation', { name: 'Providers', exact: true })
    .getByRole('button', { name: 'E2E Local', exact: true })
    .click()
  const configuration = app.window.getByRole('main', {
    name: 'Provider configuration',
    exact: true
  })
  const baseUrl = configuration.getByLabel('Base URL', { exact: true })
  await expect(baseUrl).toHaveValue(provider.baseUrl)

  // Pause renderer timers so the real autosave debounce cannot win the quit race.
  // IPC and native lifecycle remain real; the focused edit does not trigger a blur save.
  const now = new Date('2026-01-01T00:00:00Z')
  await app.window.clock.install({ time: now })
  await app.window.clock.pauseAt(now)
  const latestUrl = `${provider.baseUrl}/pending-draft`
  await baseUrl.fill(latestUrl)
  await expect(baseUrl).toBeFocused()
  expect(
    await app.window.evaluate(async () => {
      if (!('api' in window)) throw new Error('The renderer preload API is unavailable.')
      // SAFETY: The real renderer preload exposes the public API at the checked window property.
      const api = window.api as WindowApiType
      const library = await api.providers.getLibrary()
      return library.customProviders.find(({ name }) => name === 'E2E Local')?.baseUrl
    })
  ).toBe(provider.baseUrl)

  // The fixture uses ElectronApplication.close(), which calls Electron app.quit().
  // Relaunch therefore exercises native before-quit draining against the same storage.
  await app.relaunch()
  await app.window.getByRole('button', { name: 'Settings', exact: true }).click()
  await app.window
    .getByRole('navigation', { name: 'Providers', exact: true })
    .getByRole('button', { name: 'E2E Local', exact: true })
    .click()
  await expect(
    app.window
      .getByRole('main', { name: 'Provider configuration', exact: true })
      .getByLabel('Base URL', { exact: true })
  ).toHaveValue(latestUrl)
})
