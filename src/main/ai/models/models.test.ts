import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
  ChatProvider,
  ChatProviderConfiguration,
  ModelReasoningCapabilities
} from '@mico/ai-providers'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { ProviderDatabase } from '@main/data/provider-database'
import { Models } from './models'
import { ModelSelectionError } from './selection'

type CreatedProvider = Pick<ChatProvider, 'getModelCapabilities' | 'stream'>

function createFakeProvider(
  capabilities: ModelReasoningCapabilities | null = null
): CreatedProvider {
  return {
    getModelCapabilities: async () => capabilities,
    stream: async () => ({ async *[Symbol.asyncIterator]() {} })
  }
}

async function createModels(
  createChatProvider: (configuration: ChatProviderConfiguration) => CreatedProvider = () =>
    createFakeProvider()
): Promise<Models> {
  let nextEntryId = 0
  const models = new Models({
    createChatProvider,
    createId: () => `entry-${++nextEntryId}`,
    database: new ProviderDatabase({
      getUserDataPath: () => join(tmpdir(), 'mico-models'),
      openDatabase: () => new Database(':memory:')
    }),
    discoverModels: async () => []
  })
  await models.initialize()
  return models
}

/** Enables the provider, adds and enables the model, and selects it globally. */
async function selectOllamaModel(models: Models, modelId: string) {
  await models.saveLibrary({
    ...models.getLibrary(),
    configurations: [{ provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: true }]
  })
  const entry = await models.addModel({ provider: 'ollama', modelId, displayName: modelId })
  await models.saveLibrary({
    ...models.getLibrary(),
    models: models.getLibrary().models.map((model) => ({ ...model, enabled: true })),
    selectedModelId: entry.id
  })
  return entry
}

describe('Models', () => {
  it('user sends a first turn when no profile is stored, then the globally selected model answers', async () => {
    const providersByModelId = new Map<string, CreatedProvider>()
    const models = await createModels((configuration) => {
      const provider = createFakeProvider()
      providersByModelId.set(configuration.modelId, provider)
      return provider
    })
    const entry = await selectOllamaModel(models, 'qwen3:8b')

    const selection = models.resolveForSession(null)

    expect(selection.modelEntryId).toBe(entry.id)
    expect(selection.configuration).toEqual({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      modelId: 'qwen3:8b'
    })
    expect(selection.provider).toBe(providersByModelId.get('qwen3:8b'))
  })

  it('user sends when the stored model entry no longer exists, then selection fails without falling back', async () => {
    const models = await createModels()
    await selectOllamaModel(models, 'qwen3:8b')
    const storedProfile = models.toProfile(
      { provider: 'ollama', baseUrl: 'http://localhost:11434', modelId: 'gone-model' },
      'gone-entry',
      'default'
    )

    expect(() => models.resolveForSession(storedProfile)).toThrow(ModelSelectionError)
    expect(() => models.resolveForProfile(storedProfile)).toThrow(
      'The original model is unavailable. Restore its provider settings before retrying this turn.'
    )
  })

  it('user changes the global model when a profile is stored, then the original model still answers', async () => {
    const models = await createModels()
    const originalEntry = await selectOllamaModel(models, 'original-model')
    const originalSelection = models.resolveForSession(null)
    const storedProfile = models.toProfile(
      originalSelection.configuration,
      originalEntry.id,
      'none'
    )
    const replacementEntry = await selectOllamaModel(models, 'replacement-model')

    const sessionSelection = models.resolveForSession(storedProfile)
    const retrySelection = models.resolveForProfile(storedProfile)

    expect(models.getLibrary().selectedModelId).toBe(replacementEntry.id)
    expect(sessionSelection.modelEntryId).toBe(originalEntry.id)
    expect(sessionSelection.configuration.modelId).toBe('original-model')
    expect(retrySelection.modelEntryId).toBe(originalEntry.id)
    expect(retrySelection.configuration.modelId).toBe('original-model')
    expect(() =>
      models.resolveForProfile({ ...storedProfile, providerId: 'different-provider' })
    ).toThrow(
      'The original provider configuration changed. Restore its endpoint and model settings before retrying this turn.'
    )
    expect(() =>
      models.resolveForProfile({ ...storedProfile, modelId: 'different-model' })
    ).toThrow(
      'The original provider configuration changed. Restore its endpoint and model settings before retrying this turn.'
    )
  })

  it('user retries when the endpoint has changed, then recovery is blocked', async () => {
    const models = await createModels()
    const entry = await selectOllamaModel(models, 'qwen3:8b')
    const original = models.toProfile(
      { provider: 'ollama', baseUrl: 'http://localhost:11434', modelId: 'qwen3:8b' },
      entry.id,
      'default'
    )
    await models.saveLibrary({
      ...models.getLibrary(),
      configurations: [{ provider: 'ollama', baseUrl: 'http://changed:11434', enabled: true }]
    })

    expect(() => models.resolveForProfile(original)).toThrow(
      'The original provider configuration changed. Restore its endpoint and model settings before retrying this turn.'
    )
  })

  it('user corrects the API key when retrying the original endpoint, then the repaired credentials are accepted', async () => {
    const models = await createModels()
    const configuration = {
      provider: 'openai-compatible' as const,
      baseUrl: 'https://example.test/v1',
      apiKey: 'old-test-key'
    }
    await models.saveLibrary({
      ...models.getLibrary(),
      configurations: [{ ...configuration, enabled: true }]
    })
    const entry = await models.addModel({ provider: 'openai-compatible', modelId: 'gpt-5.6' })
    await models.saveLibrary({
      ...models.getLibrary(),
      models: models.getLibrary().models.map((model) => ({ ...model, enabled: true })),
      selectedModelId: entry.id
    })
    const original = models.toProfile({ ...configuration, modelId: 'gpt-5.6' }, entry.id, 'default')
    // Fixed bytes from the persisted SHA-256 contract, excluding only apiKey.
    expect(original).toEqual({
      modelEntryId: entry.id,
      providerId: 'openai-compatible',
      modelId: 'gpt-5.6',
      thinkingEffort: 'default',
      configurationDigest: 'f39acf05dd4a66191d29aef56d4aae32b3feb26bd7dfa433a4cd66b8d567b1cc'
    })
    await models.saveLibrary({
      ...models.getLibrary(),
      configurations: [{ ...configuration, apiKey: 'corrected-test-key', enabled: true }]
    })

    const selection = models.resolveForProfile(original)

    expect(selection.configuration).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://example.test/v1',
      apiKey: 'corrected-test-key',
      modelId: 'gpt-5.6'
    })
  })

  it('user sends again when connection settings match, then the cached provider survives unrelated library edits', async () => {
    const models = await createModels()
    await selectOllamaModel(models, 'qwen3:8b')
    const first = models.resolveForSession(null)
    await models.saveLibrary({
      ...models.getLibrary(),
      models: models.getLibrary().models.map((entry) => ({ ...entry, displayName: 'Renamed' }))
    })

    const renamed = models.resolveForSession(null)
    await models.saveLibrary({
      ...models.getLibrary(),
      configurations: [{ provider: 'ollama', baseUrl: 'http://changed:11434', enabled: true }]
    })
    const changed = models.resolveForSession(null)
    await models.saveLibrary({
      ...models.getLibrary(),
      configurations: [{ provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: true }]
    })
    const restored = models.resolveForSession(null)

    expect(renamed.provider).toBe(first.provider)
    expect(changed.provider).not.toBe(first.provider)
    expect(restored.provider).toBe(first.provider)
  })

  it('user checks thinking capabilities when no session model is supplied, then the globally selected model answers', async () => {
    const capabilities: ModelReasoningCapabilities = {
      selectableEfforts: ['medium', 'high'],
      defaultEffort: 'medium'
    }
    const models = await createModels((configuration) =>
      createFakeProvider(configuration.modelId === 'qwen3:8b' ? capabilities : null)
    )
    const selectedEntry = await selectOllamaModel(models, 'qwen3:8b')
    const otherEntry = await selectOllamaModel(models, 'other-model')
    await models.saveLibrary({ ...models.getLibrary(), selectedModelId: selectedEntry.id })

    expect(await models.getCapabilities()).toEqual(capabilities)
    expect(await models.getCapabilities(null)).toEqual(capabilities)
    expect(await models.getCapabilities(otherEntry.id)).toBeNull()
    expect(await models.getCapabilities('missing-entry')).toBeNull()
  })
})
