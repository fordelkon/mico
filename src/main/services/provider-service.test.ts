import { describe, expect, it } from 'vitest'
import { join } from 'node:path'

import { ProviderService } from './provider-service'

const libraryPath = join('/user-data', 'providers.json')

type MemoryFiles = {
  files: Map<string, string>
  operations: string[]
  service: ProviderService
}

function createService({
  contents,
  discoveredModels = []
}: {
  contents?: string
  discoveredModels?: Array<{ displayName: string; modelId: string }>
} = {}): MemoryFiles {
  const files = new Map<string, string>(contents ? [[libraryPath, contents]] : [])
  const operations: string[] = []
  const service = new ProviderService({
    createId: () => 'entry-1',
    discoverModels: async () => discoveredModels,
    fileSystem: {
      mkdir: async () => undefined,
      readFile: async (path) => {
        const contents = files.get(path)
        if (contents === undefined) throw new Error('ENOENT')
        return contents
      },
      rename: async (from, to) => {
        operations.push(`rename:${from}:${to}`)
        files.set(to, files.get(from) ?? '')
        files.delete(from)
      },
      writeFile: async (path, contents) => {
        operations.push(`write:${path}`)
        files.set(path, contents)
      }
    },
    getUserDataPath: () => '/user-data'
  })

  return { files, operations, service }
}

describe('ProviderService', () => {
  it('initializes the two local provider defaults when no library is persisted', async () => {
    const { service } = createService()

    await service.initialize()

    expect(service.getLibrary()).toEqual({
      configurations: [
        { provider: 'lm-studio', baseUrl: 'http://localhost:1234' },
        { provider: 'ollama', baseUrl: 'http://localhost:11434' }
      ],
      models: [],
      selectedModelId: null
    })
  })

  it('recovers the local defaults when the persisted library is malformed', async () => {
    const { service } = createService({ contents: '{invalid json' })

    await service.initialize()

    expect(service.getLibrary()).toEqual({
      configurations: [
        { provider: 'lm-studio', baseUrl: 'http://localhost:1234' },
        { provider: 'ollama', baseUrl: 'http://localhost:11434' }
      ],
      models: [],
      selectedModelId: null
    })
  })

  it('writes an imported model by replacing the library through a temporary file', async () => {
    const { files, operations, service } = createService()
    await service.initialize()

    await service.importModel({
      provider: 'ollama',
      modelId: 'llama3.2:latest',
      displayName: 'Llama 3.2'
    })

    expect(operations).toEqual([
      `write:${libraryPath}.tmp`,
      `rename:${libraryPath}.tmp:${libraryPath}`
    ])
    expect(JSON.parse(files.get(libraryPath) ?? '')).toMatchObject({
      models: [
        {
          id: 'entry-1',
          provider: 'ollama',
          modelId: 'llama3.2:latest',
          displayName: 'Llama 3.2'
        }
      ]
    })
  })

  it('preserves the original entry when an import has the same provider and model ID', async () => {
    const { service } = createService()
    await service.initialize()
    await service.importModel({
      provider: 'ollama',
      modelId: 'llama3.2:latest',
      displayName: 'Llama 3.2'
    })

    const library = await service.importModel({
      provider: 'ollama',
      modelId: 'llama3.2:latest',
      displayName: 'Changed'
    })

    expect(library.models).toEqual([
      {
        id: 'entry-1',
        provider: 'ollama',
        modelId: 'llama3.2:latest',
        displayName: 'Llama 3.2'
      }
    ])
  })

  it('clears selection when the selected entry is removed', async () => {
    const { service } = createService()
    await service.initialize()
    await service.addModel({ provider: 'ollama', modelId: 'llama3.2:latest' })
    await service.selectModel('entry-1')

    const library = await service.removeModel('entry-1')

    expect(library).toMatchObject({ models: [], selectedModelId: null })
  })

  it('saves complete remote configurations and uses them for discovery', async () => {
    const { service } = createService({
      discoveredModels: [{ modelId: 'gpt-5.6', displayName: 'GPT-5.6' }]
    })
    const configuration = {
      provider: 'openai-responses' as const,
      baseUrl: 'https://api.openai.com/v1/responses',
      apiKey: 'key'
    }
    await service.initialize()

    const library = await service.saveConfiguration(configuration)

    await expect(service.discoverModels(configuration)).resolves.toEqual([
      { modelId: 'gpt-5.6', displayName: 'GPT-5.6' }
    ])
    expect(library.configurations).toContainEqual(configuration)
  })

  it('resolves the selected entry into its chat provider configuration', async () => {
    const { service } = createService()
    await service.initialize()
    await service.saveConfiguration({
      provider: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1/responses',
      apiKey: 'key'
    })
    await service.importModel({
      provider: 'openai-responses',
      modelId: 'gpt-5.6',
      displayName: 'GPT-5.6'
    })
    await service.selectModel('entry-1')

    expect(service.getSelectedChatConfiguration()).toEqual({
      provider: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1/responses',
      apiKey: 'key',
      modelId: 'gpt-5.6'
    })
  })
})
