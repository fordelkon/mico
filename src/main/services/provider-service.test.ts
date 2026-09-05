import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { ProviderDatabase } from '../data/provider-database'
import { ProviderService } from './provider-service'

async function createService({ userDataPath }: { userDataPath?: string } = {}) {
  let nextEntryId = 0
  const database = new ProviderDatabase({
    getUserDataPath: () => userDataPath ?? join(tmpdir(), 'mico-provider-service'),
    openDatabase: () => new Database(':memory:')
  })
  const service = new ProviderService({
    createId: () => `entry-${++nextEntryId}`,
    database,
    discoverModels: async () => [{ modelId: 'gpt-5.6', displayName: 'GPT-5.6' }]
  })
  await service.initialize()
  return service
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
      models: [],
      selectedModelId: null
    })
  })

  it('stores provider configuration including API keys, headers, and enabled state', async () => {
    const service = await createService()

    await service.saveConfiguration({
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      headers: { 'X-Client': 'Mico' },
      enabled: true,
      useMaxCompletionTokens: true
    })

    expect(service.getLibrary().configurations).toContainEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      headers: { 'X-Client': 'Mico' },
      enabled: true,
      useMaxCompletionTokens: true
    })
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
    await service.addModel({ provider: 'ollama', modelId: 'llama3.2' })
    await service.selectModel('entry-1')
    await service.removeModel('entry-1')

    expect(service.getLibrary()).toMatchObject({ models: [], selectedModelId: null })
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
