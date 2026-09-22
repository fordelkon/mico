import { test } from '../fixtures/electron.fixture'
import { sendUserMessage, selectChatModel } from '../utils/chat'
import { configureRealProvider, isConfigured, realEndpoints } from '../utils/real-provider'

test.describe('Real provider chat', () => {
  for (const endpoint of realEndpoints) {
    test(`user gets a reply when chatting through the ${endpoint.id} endpoint, then the assistant answers`, async ({
      mainWindow
    }) => {
      test.skip(
        !isConfigured(endpoint),
        `Set MICO_E2E_API_KEY with the ${endpoint.id} base URL and model`
      )

      await configureRealProvider(mainWindow, endpoint)
      await selectChatModel(mainWindow, endpoint.modelId)
      await sendUserMessage(mainWindow, 'Reply with the single word: OK.')
    })
  }
})
