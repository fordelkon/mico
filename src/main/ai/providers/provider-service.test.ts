import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import type { ProviderLibrary } from '@shared/data/schemas/provider'
import { ProviderDatabase } from '../../data/provider-database'
import { ProviderService } from './provider-service'

async function enableOllama(service: ProviderService, enabled = true): Promise<void> {
  await service.saveLibrary({
    ...service.getLibrary(),
    configurations: [{ provider: 'ollama', baseUrl: 'http://localhost:11434', enabled }]
  })
}

async function setModelEnabled(
  service: ProviderService,
  modelId: string,
  enabled: boolean
): Promise<void> {
  await service.saveLibrary({
    ...service.getLibrary(),
    models: service
      .getLibrary()
      .models.map((model) => (model.id === modelId ? { ...model, enabled } : model))
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
    const first = await service.addModel({
      provider: 'ollama',
      modelId: 'first-model',
      displayName: 'First model'
    })
    const second = await service.addModel({
      provider: 'ollama',
      modelId: 'second-model',
      displayName: 'Second model'
    })
    await service.saveLibrary({
      ...service.getLibrary(),
      models: service.getLibrary().models.map((model) => ({ ...model, enabled: true }))
    })
    await service.saveLibrary({ ...service.getLibrary(), selectedModelId: first.id })

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

  it('user sees dangling selections cleared when a snapshot outlives its own removal, then the state stays coherent', async () => {
    const service = await createService()

    const library: ProviderLibrary = {
      ...service.getLibrary(),
      selectedProviderId: 'removed-provider',
      selectedModelId: 'removed-model'
    }
    await service.saveLibrary(library)

    expect(service.getLibrary().selectedProviderId).toBeNull()
    expect(service.getLibrary().selectedModelId).toBeNull()
  })

  it('user sees provider activation preserved when the library reopens, then enabled order stays', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'mico-provider-enabled-order-'))
    let initial: Awaited<ReturnType<typeof createPersistentService>> | undefined
    let restarted: Awaited<ReturnType<typeof createPersistentService>> | undefined
    try {
      initial = await createPersistentService(userDataPath)
      await enableOllama(initial.service)
      await initial.service.addModel({ provider: 'ollama', modelId: 'llama3.2' })

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

      await initial.service.saveLibrary({
        ...initial.service.getLibrary(),
        selectedProviderId: 'ollama'
      })
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

  it('user sees fetched models added when syncing, then existing models stay enabled', async () => {
    const service = await createService()
    await service.addModel({ provider: 'ollama', modelId: 'llama3.2', displayName: 'Llama 3.2' })
    await setModelEnabled(service, 'entry-1', true)

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

    await setModelEnabled(service, 'entry-1', false)
    await service.saveLibrary({ ...service.getLibrary(), selectedModelId: 'entry-1' })
    expect(service.getSelectedChatConfiguration()).toBeNull()

    await setModelEnabled(service, 'entry-1', true)
    expect(service.getSelectedChatConfiguration()).toEqual({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      modelId: 'qwen3:8b'
    })

    await setModelEnabled(service, 'entry-1', false)
    expect(service.getSelectedChatConfiguration()).toBeNull()

    await setModelEnabled(service, 'entry-1', true)
    await enableOllama(service, false)
    expect(service.getSelectedChatConfiguration()).toBeNull()
  })

  it('user gets a chat configuration when selecting from a custom provider, then baseUrl and headers apply', async () => {
    const service = await createService()
    await service.saveLibrary({
      configurations: [{ provider: 'ollama', baseUrl: 'http://localhost:11434', enabled: true }],
      customProviders: [
        {
          apiFormat: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          enabled: true,
          headers: { 'X-Client': 'Mico' },
          icon: 'cloud',
          id: 'example-ai',
          name: 'Example AI'
        }
      ],
      enabledProviderIds: ['ollama', 'example-ai'],
      models: [
        {
          id: 'entry-1',
          provider: 'example-ai',
          modelId: 'gpt-5.6',
          displayName: 'GPT-5.6',
          enabled: true
        }
      ],
      selectedModelId: 'entry-1',
      selectedProviderId: 'example-ai'
    })

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
