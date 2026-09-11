import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { ProviderDatabase } from '../../data/provider-database'
import { ProviderService } from './provider-service'

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
  it('seeds the two local providers disabled in an empty SQLite library', async () => {
    const service = await createService()

    expect(service.getLibrary()).toEqual({
      configurations: [
        { provider: 'lm-studio', baseUrl: 'http://localhost:1234', enabled: false },
        { provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: false }
      ],
      customProviders: [],
      enabledProviderIds: [],
      models: [],
      selectedModelId: null,
      selectedProviderId: null
    })
  })

  it('stores provider configuration including API keys, headers, and enabled state', async () => {
    const service = await createService()

    const configuration = await service.saveConfiguration({
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      headers: { 'X-Client': 'Mico' },
      enabled: true,
      useMaxCompletionTokens: true
    })

    expect(configuration).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      headers: { 'X-Client': 'Mico' },
      enabled: true,
      useMaxCompletionTokens: true
    })
  })

  it('replaces the persisted library with one snapshot', async () => {
    const service = await createService()
    await service.addModel({ provider: 'lm-studio', modelId: 'stale-model' })

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
          name: 'Example AI',
          useMaxCompletionTokens: false
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
          name: 'Example AI',
          useMaxCompletionTokens: false
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

  it('preserves provider activation order across model changes and restart', async () => {
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
      await initial.service.saveConfiguration({
        provider: 'lm-studio',
        baseUrl: 'http://localhost:1234',
        enabled: true
      })
      await initial.service.addModel({ provider: 'ollama', modelId: 'llama3.2' })
      await initial.service.setModelEnabled({ enabled: false, modelId: 'entry-1' })

      expect(initial.service.getLibrary()).toMatchObject({
        enabledProviderIds: ['ollama', 'lm-studio']
      })

      initial.close()
      initial = undefined
      restarted = await createPersistentService(userDataPath)

      expect(restarted.service.getLibrary()).toMatchObject({
        enabledProviderIds: ['ollama', 'lm-studio']
      })
    } finally {
      initial?.close()
      restarted?.close()
      await rm(userDataPath, { force: true, recursive: true })
    }
  })

  it('persists the last visited provider after reopening the SQLite library', async () => {
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

  it('clears the last visited provider when that custom provider is removed', async () => {
    const service = await createService()
    const provider = await service.addCustomProvider({
      apiFormat: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      headers: {},
      icon: 'cloud',
      name: 'Example AI',
      useMaxCompletionTokens: false
    })
    const providerId = provider.id
    if (!providerId) throw new Error('Custom provider was not created.')

    await service.selectProvider(providerId)
    await service.removeCustomProvider(providerId)

    expect(service.getLibrary().selectedProviderId).toBeNull()
  })

  it('keeps the original model when the provider and model ID already exist', async () => {
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

  it('persists fetched models and retains the enabled state of existing models', async () => {
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

  it('clears selection when its selected model is removed', async () => {
    const service = await createService()
    await service.saveConfiguration({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      enabled: true
    })
    await service.addModel({ provider: 'ollama', modelId: 'llama3.2' })
    await service.selectModel('entry-1')
    await service.removeModel('entry-1')

    expect(service.getLibrary()).toMatchObject({ models: [], selectedModelId: null })
  })

  it('returns the committed model after changing its enabled state', async () => {
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

  it('resolves only an enabled selected model from an enabled built-in provider', async () => {
    const service = await createService()
    await service.saveConfiguration({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      enabled: true
    })
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

    await service.saveConfiguration({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      enabled: false
    })

    expect(service.getSelectedChatConfiguration()).toBeNull()
  })

  it('resolves an enabled selected model from an enabled custom provider', async () => {
    const service = await createService()
    const provider = await service.addCustomProvider({
      apiFormat: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      enabled: true,
      headers: { 'X-Client': 'Mico' },
      icon: 'cloud',
      name: 'Example AI',
      useMaxCompletionTokens: true
    })
    const providerId = provider.id
    if (!providerId) throw new Error('Custom provider was not created.')
    await service.addModel({ provider: providerId, modelId: 'gpt-5.6' })
    await service.selectModel('entry-2')

    expect(service.getSelectedChatConfiguration()).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      headers: { 'X-Client': 'Mico' },
      modelId: 'gpt-5.6',
      useMaxCompletionTokens: true
    })
  })

  it('deletes the legacy JSON without importing it after initializing SQLite', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'mico-provider-legacy-'))
    const legacyPath = join(userDataPath, 'providers.json')
    try {
      await writeFile(
        legacyPath,
        JSON.stringify({ configurations: [{ provider: 'openai-responses' }] })
      )

      const service = await createService({ userDataPath })

      await expect(access(legacyPath)).rejects.toThrow()
      expect(service.getLibrary().configurations).not.toContainEqual(
        expect.objectContaining({ provider: 'openai-responses' })
      )
    } finally {
      await rm(userDataPath, { force: true, recursive: true })
    }
  })
})
