import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { ProviderDatabase } from '../../data/provider-database'
import { ProviderService } from './provider-service'

async function enableOllama(service: ProviderService, enabled = true): Promise<void> {
  await service.saveConfiguration({
    provider: 'ollama',
    baseUrl: 'http://localhost:11434',
    enabled
  })
}

type CreateServiceOptions = {
  database?: ProviderDatabase
  userDataPath?: string
}

async function createService({ database, userDataPath }: CreateServiceOptions = {}) {
  let nextEntryId = 0
  const providerDatabase =
    database ??
    new ProviderDatabase({
      getUserDataPath: () => userDataPath ?? join(tmpdir(), 'mico-provider-service'),
      openDatabase: () => new Database(':memory:')
    })
  const service = new ProviderService({
    createId: () => `entry-${++nextEntryId}`,
    database: providerDatabase,
    discoverModels: async () => [{ modelId: 'gpt-5.6', displayName: 'GPT-5.6' }]
  })
  await service.initialize()
  return service
}

async function createPersistentService(userDataPath: string) {
  const database = new ProviderDatabase({
    getUserDataPath: () => userDataPath,
    openDatabase: (path) => new Database(path)
  })
  return { close: () => database.connection.close(), service: await createService({ database }) }
}

describe('ProviderService', () => {
  it('user gets the entry configuration when resolving a model entry, then the global selection is ignored', async () => {
    const service = await createService()
    await enableOllama(service)
    const first = await service.importModel({
      provider: 'ollama',
      modelId: 'first-model',
      displayName: 'First model'
    })
    const second = await service.importModel({
      provider: 'ollama',
      modelId: 'second-model',
      displayName: 'Second model'
    })
    await service.selectModel(first.id)

    expect(service.getChatConfigurationForModelEntry(second.id)).toMatchObject({
      provider: 'ollama',
      modelId: 'second-model'
    })
  })

  it('user sees only a disabled Ollama built-in when opening an empty library, then nothing else exists', async () => {
    const service = await createService()

    expect(service.getLibrary()).toEqual({
      configurations: [{ provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: false }],
      customProviders: [],
      enabledProviderIds: [],
      models: [],
      selectedModelId: null,
      selectedProviderId: null
    })
  })

  it('user gets the configuration stored when saving it, then reading it back returns the same values', async () => {
    const service = await createService()

    const configuration = await service.saveConfiguration({
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      headers: { 'X-Client': 'Mico' },
      enabled: true
    })

    expect(configuration).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      headers: { 'X-Client': 'Mico' },
      enabled: true
    })
  })

  it('user gets the whole library replaced when saving a snapshot, then the state matches it exactly', async () => {
    const service = await createService()
    await service.addModel({ provider: 'ollama', modelId: 'stale-model' })

    await service.saveLibrary({
      configurations: [{ provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: true }],
      customProviders: [
        {
          apiFormat: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          enabled: true,
          headers: {},
          icon: 'cloud',
          id: 'example-ai',
          name: 'Example AI'
        }
      ],
      enabledProviderIds: ['ollama', 'example-ai'],
      models: [
        {
          id: 'model-1',
          provider: 'ollama',
          modelId: 'qwen3',
          displayName: 'Qwen 3',
          enabled: true
        }
      ],
      selectedModelId: 'model-1',
      selectedProviderId: 'ollama'
    })

    expect(service.getLibrary()).toEqual({
      configurations: [{ provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: true }],
      customProviders: [
        {
          apiFormat: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          enabled: true,
          headers: {},
          icon: 'cloud',
          id: 'example-ai',
          name: 'Example AI'
        }
      ],
      enabledProviderIds: ['ollama', 'example-ai'],
      models: [
        {
          id: 'model-1',
          provider: 'ollama',
          modelId: 'qwen3',
          displayName: 'Qwen 3',
          enabled: true
        }
      ],
      selectedModelId: 'model-1',
      selectedProviderId: 'ollama'
    })
  })

  it('user sees provider activation preserved when the library reopens, then enabled order stays', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'mico-provider-enabled-order-'))
    let initial: Awaited<ReturnType<typeof createPersistentService>> | undefined
    let restarted: Awaited<ReturnType<typeof createPersistentService>> | undefined
    try {
      initial = await createPersistentService(userDataPath)
      await initial.service.saveConfiguration({
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
        enabled: true
      })
      await initial.service.addModel({ provider: 'ollama', modelId: 'llama3.2' })
      await initial.service.setModelEnabled({ enabled: false, modelId: 'entry-1' })

      expect(initial.service.getLibrary()).toMatchObject({
        enabledProviderIds: ['ollama']
      })

      initial.close()
      initial = undefined
      restarted = await createPersistentService(userDataPath)

      expect(restarted.service.getLibrary()).toMatchObject({
        enabledProviderIds: ['ollama']
      })
    } finally {
      initial?.close()
      restarted?.close()
      await rm(userDataPath, { force: true, recursive: true })
    }
  })

  it('user returns to the last visited provider when reopening the library, then the selection is restored', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'mico-provider-selection-'))
    let initial: Awaited<ReturnType<typeof createPersistentService>> | undefined
    let restarted: Awaited<ReturnType<typeof createPersistentService>> | undefined
    try {
      initial = await createPersistentService(userDataPath)

      await initial.service.selectProvider('ollama')
      initial.close()
      initial = undefined
      restarted = await createPersistentService(userDataPath)

      expect(restarted.service.getLibrary().selectedProviderId).toBe('ollama')
    } finally {
      initial?.close()
      restarted?.close()
      await rm(userDataPath, { force: true, recursive: true })
    }
  })

  it('user sees the custom provider removed when it is deleted, then the selection is cleared', async () => {
    const service = await createService()
    const provider = await service.addCustomProvider({
      apiFormat: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      headers: {},
      icon: 'cloud',
      name: 'Example AI'
    })
    const providerId = provider.id
    if (!providerId) throw new Error('Custom provider was not created.')

    await service.selectProvider(providerId)
    await service.removeCustomProvider(providerId)

    expect(service.getLibrary().selectedProviderId).toBeNull()
  })

  it('user keeps the original model when importing a duplicate, then the changed display name is ignored', async () => {
    const service = await createService()
    await service.importModel({ provider: 'ollama', modelId: 'llama3.2', displayName: 'Llama 3.2' })
    await service.importModel({ provider: 'ollama', modelId: 'llama3.2', displayName: 'Changed' })

    expect(service.getLibrary().models).toEqual([
      {
        id: 'entry-1',
        provider: 'ollama',
        modelId: 'llama3.2',
        displayName: 'Llama 3.2',
        enabled: true
      }
    ])
  })

  it('user sees fetched models added when syncing, then existing models stay enabled', async () => {
    const service = await createService()
    await service.importModel({ provider: 'ollama', modelId: 'llama3.2', displayName: 'Llama 3.2' })

    await service.syncModels({
      provider: 'ollama',
      models: [
        { modelId: 'llama3.2', displayName: 'Llama 3.2' },
        { modelId: 'qwen3', displayName: 'Qwen 3' }
      ]
    })

    expect(service.getLibrary().models).toEqual([
      {
        id: 'entry-1',
        provider: 'ollama',
        modelId: 'llama3.2',
        displayName: 'Llama 3.2',
        enabled: true
      },
      {
        id: 'entry-2',
        provider: 'ollama',
        modelId: 'qwen3',
        displayName: 'Qwen 3',
        enabled: false
      }
    ])
  })

  it('user sees the model removed when it is deleted, then the selection is cleared', async () => {
    const service = await createService()
    await enableOllama(service)
    await service.addModel({ provider: 'ollama', modelId: 'llama3.2' })
    await service.setModelEnabled({ enabled: true, modelId: 'entry-1' })
    await service.selectModel('entry-1')
    await service.removeModel('entry-1')

    expect(service.getLibrary()).toMatchObject({ models: [], selectedModelId: null })
  })

  it('user gets the committed model when changing its enabled state, then the entry reflects it', async () => {
    const service = await createService()
    await service.addModel({ provider: 'ollama', modelId: 'llama3.2' })

    const model = await service.setModelEnabled({ enabled: false, modelId: 'entry-1' })

    expect(model).toEqual({
      displayName: 'llama3.2',
      enabled: false,
      id: 'entry-1',
      modelId: 'llama3.2',
      provider: 'ollama'
    })
  })

  it('user sees manual models added when the library is synced, then they are disabled, first, and unique', async () => {
    const service = await createService()
    await service.syncModels({
      provider: 'ollama',
      models: [{ modelId: 'fetched-model', displayName: 'Fetched model' }]
    })

    await service.addModel({
      provider: 'ollama',
      modelId: 'manual-model',
      displayName: 'Manual model'
    })
    const existing = await service.addModel({
      provider: 'ollama',
      modelId: 'manual-model',
      displayName: 'Changed manual model'
    })

    expect(existing).toEqual({
      displayName: 'Manual model',
      enabled: false,
      id: 'entry-2',
      modelId: 'manual-model',
      provider: 'ollama'
    })
    expect(service.getLibrary().models.map(({ modelId }) => modelId)).toEqual([
      'manual-model',
      'fetched-model'
    ])
  })

  it('user gets a chat configuration when the model is enabled, then disabled states resolve to null', async () => {
    const service = await createService()
    await enableOllama(service)
    await service.addModel({ provider: 'ollama', modelId: 'qwen3:8b' })

    await service.setModelEnabled({ modelId: 'entry-1', enabled: false })
    await expect(service.selectModel('entry-1')).rejects.toThrow(
      'Selected model is not enabled in the library.'
    )

    await service.setModelEnabled({ modelId: 'entry-1', enabled: true })
    await service.selectModel('entry-1')

    expect(service.getSelectedChatConfiguration()).toEqual({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      modelId: 'qwen3:8b'
    })

    await service.setModelEnabled({ modelId: 'entry-1', enabled: false })

    expect(service.getSelectedChatConfiguration()).toBeNull()

    await service.setModelEnabled({ modelId: 'entry-1', enabled: true })
    await service.selectModel('entry-1')

    await enableOllama(service, false)

    expect(service.getSelectedChatConfiguration()).toBeNull()
  })

  it('user gets a chat configuration when selecting from a custom provider, then baseUrl and headers apply', async () => {
    const service = await createService()
    const provider = await service.addCustomProvider({
      apiFormat: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      enabled: true,
      headers: { 'X-Client': 'Mico' },
      icon: 'cloud',
      name: 'Example AI'
    })
    const providerId = provider.id
    if (!providerId) throw new Error('Custom provider was not created.')
    await service.addModel({ provider: providerId, modelId: 'gpt-5.6' })
    await service.setModelEnabled({ modelId: 'entry-2', enabled: true })
    await service.selectModel('entry-2')

    expect(service.getSelectedChatConfiguration()).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      headers: { 'X-Client': 'Mico' },
      modelId: 'gpt-5.6'
    })
  })

  it('user sees the legacy JSON deleted when the library initializes, then its providers are not imported', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'mico-provider-legacy-'))
    const legacyPath = join(userDataPath, 'providers.json')
    try {
      await writeFile(
        legacyPath,
        JSON.stringify({ configurations: [{ provider: 'openai-responses' }] })
      )

      const service = await createService({ userDataPath })

      await expect(access(legacyPath)).rejects.toThrow(/ENOENT/)
      expect(service.getLibrary().configurations).not.toContainEqual(
        expect.objectContaining({ provider: 'openai-responses' })
      )
    } finally {
      await rm(userDataPath, { force: true, recursive: true })
    }
  })
})
