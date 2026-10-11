import { describe, expect, it } from 'vitest'
import { SessionModelProfile } from './session-model-profile'

const configuration = {
  provider: 'ollama' as const,
  baseUrl: 'http://localhost:11434',
  modelId: 'original'
}
describe('SessionModelProfile', () => {
  it('user corrects the API key when retrying the original endpoint, then the repaired credentials are accepted', () => {
    const original = {
      provider: 'openai-compatible' as const,
      baseUrl: 'https://example.test/v1',
      modelId: 'original',
      apiKey: 'old-test-key'
    }
    const corrected = { ...original, apiKey: 'corrected-test-key' }
    const profiles = new SessionModelProfile({
      resolveProvider: () => ({
        getModelCapabilities: async () => null,
        stream: async () => ({
          async *[Symbol.asyncIterator]() {
            yield* []
          }
        })
      }),
      getChatConfigurationForModelEntry: () => corrected
    })
    expect(
      profiles.resolveForProfile(profiles.toProfile(original, 'original-entry', 'none'))
        .configuration
    ).toEqual(corrected)
  })
  it('user retries after changing the selected model when the original remains configured, then the original profile resolves', () => {
    const profiles = new SessionModelProfile({
      resolveProvider: () => ({
        stream: async () => ({ async *[Symbol.asyncIterator]() {} }),
        getModelCapabilities: async () => null
      }),
      getChatConfigurationForModelEntry: () => configuration
    })
    const original = profiles.toProfile(configuration, 'original-entry', 'none')
    expect(profiles.resolveForProfile(original)).toMatchObject({
      configuration,
      modelEntryId: 'original-entry'
    })
  })
  it('user retries after changing the endpoint when the configuration differs, then recovery is blocked', () => {
    const profiles = new SessionModelProfile({
      resolveProvider: () => null,
      getChatConfigurationForModelEntry: () => ({
        ...configuration,
        baseUrl: 'http://changed:11434'
      })
    })
    expect(() =>
      profiles.resolveForProfile(profiles.toProfile(configuration, 'original-entry', 'none'))
    ).toThrow('changed')
  })
})
