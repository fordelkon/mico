import { test as electronTest, expect } from './electron.fixture'
import { startLocalProvider } from '../utils/local-provider'
import { configureProvider } from '../utils/provider'
import { selectChatModel } from '../utils/chat'

type LocalProvider = Awaited<ReturnType<typeof startLocalProvider>>

export const test = electronTest.extend<{ provider: LocalProvider; configuredApp: void }>({
  provider: async ({}, use) => {
    const provider = await startLocalProvider()
    try {
      await use(provider)
      expect(
        provider.errors,
        'The local provider received an invalid or unexpected request'
      ).toEqual([])
    } finally {
      await provider.close()
    }
  },
  configuredApp: [
    async ({ app, provider }, use) => {
      await configureProvider(app.window, {
        ...provider,
        providerName: 'E2E Local',
        apiFormat: 'openai-compatible'
      })
      await selectChatModel(app.window, provider.modelId)
      await use()
    },
    { auto: true }
  ]
})

export { expect } from '@playwright/test'
