import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

import { discoverModels } from '@mico/ai-providers'
import type { ChatProviderConfiguration, DiscoveredModel } from '@mico/ai-providers'
import { ProviderLibrarySchema } from '@shared/data/schemas/provider'
import type {
  ModelEntry,
  ProviderConfiguration,
  ProviderLibrary
} from '@shared/data/schemas/provider'
import type { AddModelRequest, ImportModelRequest } from '@shared/ipc/schemas/providers'

type ProviderFileSystem = {
  mkdir: (path: string, options: { recursive: true }) => Promise<string | undefined>
  readFile: (path: string, encoding: 'utf8') => Promise<string>
  rename: (from: string, to: string) => Promise<void>
  writeFile: (path: string, contents: string, encoding: 'utf8') => Promise<void>
}
type ProviderServiceDependencies = {
  createId?: () => string
  discoverModels?: (configuration: ProviderConfiguration) => Promise<DiscoveredModel[]>
  fileSystem?: ProviderFileSystem
  getUserDataPath?: () => string
}

const defaultDependencies: Required<ProviderServiceDependencies> = {
  createId: () => crypto.randomUUID(),
  discoverModels,
  fileSystem: { mkdir, readFile, rename, writeFile },
  getUserDataPath: () => app.getPath('userData')
}

function createDefaultLibrary(): ProviderLibrary {
  return {
    configurations: [
      { provider: 'lm-studio', baseUrl: 'http://localhost:1234' },
      { provider: 'ollama', baseUrl: 'http://localhost:11434' }
    ],
    models: [],
    selectedModelId: null
  }
}

class ProviderService {
  private library: ProviderLibrary = createDefaultLibrary()
  private readonly dependencies: Required<ProviderServiceDependencies>

  constructor(dependencies: ProviderServiceDependencies = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies }
  }

  async initialize(): Promise<void> {
    this.library = await this.readLibrary()
  }

  getLibrary(): ProviderLibrary {
    return structuredClone(this.library)
  }

  async saveConfiguration(configuration: ProviderConfiguration): Promise<ProviderLibrary> {
    await this.updateLibrary((library) => {
      const index = library.configurations.findIndex(
        ({ provider }) => provider === configuration.provider
      )
      if (index === -1) library.configurations.push(configuration)
      else library.configurations[index] = configuration
    })
    return this.getLibrary()
  }

  async discoverModels(configuration: ProviderConfiguration): Promise<DiscoveredModel[]> {
    return this.dependencies.discoverModels(configuration)
  }

  async importModel(model: ImportModelRequest): Promise<ProviderLibrary> {
    if (
      this.library.models.some(
        ({ provider, modelId }) => provider === model.provider && modelId === model.modelId
      )
    ) {
      return this.getLibrary()
    }

    await this.updateLibrary((library) => {
      library.models.push({ id: this.dependencies.createId(), ...model })
    })
    return this.getLibrary()
  }

  async addModel(model: AddModelRequest): Promise<ProviderLibrary> {
    return this.importModel({
      provider: model.provider,
      modelId: model.modelId,
      displayName: model.displayName ?? model.modelId
    })
  }

  async removeModel(modelId: string): Promise<ProviderLibrary> {
    await this.updateLibrary((library) => {
      library.models = library.models.filter(({ id }) => id !== modelId)
      if (library.selectedModelId === modelId) library.selectedModelId = null
    })
    return this.getLibrary()
  }

  async selectModel(modelId: string | null): Promise<ProviderLibrary> {
    if (modelId !== null && !this.library.models.some(({ id }) => id === modelId)) {
      throw new Error('Selected model does not exist in the library.')
    }

    await this.updateLibrary((library) => {
      library.selectedModelId = modelId
    })
    return this.getLibrary()
  }

  getSelectedChatConfiguration(): ChatProviderConfiguration | null {
    const model = this.library.models.find(({ id }) => id === this.library.selectedModelId)
    const configuration = model
      ? this.library.configurations.find(({ provider }) => provider === model.provider)
      : undefined

    return model && configuration ? toChatProviderConfiguration(configuration, model) : null
  }

  private async readLibrary(): Promise<ProviderLibrary> {
    try {
      const contents = await this.dependencies.fileSystem.readFile(this.libraryPath, 'utf8')
      return ProviderLibrarySchema.safeParse(JSON.parse(contents)).data ?? createDefaultLibrary()
    } catch {
      return createDefaultLibrary()
    }
  }

  private async updateLibrary(update: (library: ProviderLibrary) => void): Promise<void> {
    const library = this.getLibrary()
    update(library)
    await this.writeLibrary(library)
    this.library = library
  }

  private async writeLibrary(library: ProviderLibrary): Promise<void> {
    await this.dependencies.fileSystem.mkdir(this.dependencies.getUserDataPath(), {
      recursive: true
    })
    const temporaryPath = `${this.libraryPath}.tmp`
    await this.dependencies.fileSystem.writeFile(temporaryPath, JSON.stringify(library), 'utf8')
    await this.dependencies.fileSystem.rename(temporaryPath, this.libraryPath)
  }

  private get libraryPath(): string {
    return join(this.dependencies.getUserDataPath(), 'providers.json')
  }
}

function toChatProviderConfiguration(
  configuration: ProviderConfiguration,
  model: ModelEntry
): ChatProviderConfiguration {
  switch (configuration.provider) {
    case 'lm-studio':
      return configuration.apiKey
        ? { ...configuration, modelId: model.modelId }
        : {
            provider: configuration.provider,
            baseUrl: configuration.baseUrl,
            modelId: model.modelId
          }
    case 'ollama':
      return { ...configuration, modelId: model.modelId }
    case 'openai-responses':
      return { ...configuration, modelId: model.modelId }
    case 'openai-compatible':
      return configuration.apiKey
        ? { ...configuration, modelId: model.modelId }
        : {
            provider: configuration.provider,
            baseUrl: configuration.baseUrl,
            modelId: model.modelId
          }
    case 'anthropic-compatible':
      return { ...configuration, modelId: model.modelId }
  }
}

export { ProviderService }
export type { ProviderFileSystem, ProviderServiceDependencies }
