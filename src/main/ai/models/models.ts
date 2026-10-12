import { createHash } from 'node:crypto'

import type {
  ChatProvider,
  ChatProviderConfiguration,
  DiscoveredModel,
  ModelReasoningCapabilities
} from '@mico/ai-providers'

import { createChatProvider } from '@mico/ai-providers'
import type {
  ModelEntry,
  ProviderConfiguration,
  ProviderLibrary
} from '@shared/data/schemas/provider'
import type {
  AddModelRequest,
  SyncModelsRequest,
  TestModelRequest
} from '@shared/ipc/schemas/providers'
import type { ExecutionProfileSnapshot } from '@shared/data/schemas/session'
import { ModelLibrary, testModelByStreaming, type ModelLibraryDependencies } from './library'
import { createModelResolver, type ModelResolver } from './resolver'
import { ModelSelectionError, type ModelSelection } from './selection'

type ModelsDependencies = ModelLibraryDependencies & {
  createChatProvider?: (
    configuration: ChatProviderConfiguration
  ) => Pick<ChatProvider, 'getModelCapabilities' | 'stream'>
}

/**
 * The models module's public surface: provider library CRUD plus pure
 * selection — turning a stored execution profile or the global selection into
 * the provider, configuration, and model entry backing a request. It depends
 * on no session or conversation state, so callers bring their own stored
 * profiles and decide what happens with the resulting selection.
 */
class Models {
  readonly #library: ModelLibrary
  readonly #resolveProvider: ModelResolver

  constructor(dependencies: ModelsDependencies = {}) {
    const resolveChatProvider = dependencies.createChatProvider ?? createChatProvider
    this.#library = new ModelLibrary({
      createId: dependencies.createId,
      database: dependencies.database,
      discoverModels: dependencies.discoverModels,
      testModel: dependencies.testModel ?? testModelByStreaming(resolveChatProvider)
    })
    this.#resolveProvider = createModelResolver({
      createChatProvider: resolveChatProvider,
      getChatConfigurationForModelEntry: (modelEntryId) =>
        this.#library.getChatConfigurationForModelEntry(modelEntryId)
    })
  }

  async initialize(): Promise<void> {
    await this.#library.initialize()
  }

  getLibrary(): ProviderLibrary {
    return this.#library.getLibrary()
  }

  async saveLibrary(library: ProviderLibrary): Promise<ProviderLibrary> {
    return this.#library.saveLibrary(library)
  }

  async discoverModels(configuration: ProviderConfiguration): Promise<DiscoveredModel[]> {
    return this.#library.discoverModels(configuration)
  }

  async syncModels(request: SyncModelsRequest): Promise<void> {
    await this.#library.syncModels(request)
  }

  async addModel(model: AddModelRequest): Promise<ModelEntry> {
    return this.#library.addModel(model)
  }

  async testModel(request: TestModelRequest): Promise<void> {
    await this.#library.testModel(request)
  }

  getChatConfigurationForModelEntry(modelEntryId: string): ChatProviderConfiguration | null {
    return this.#library.getChatConfigurationForModelEntry(modelEntryId)
  }

  private getSelectedChatConfiguration(): ChatProviderConfiguration | null {
    return this.#library.getSelectedChatConfiguration()
  }

  private getSelectedModelEntryId(): string | null {
    return this.#library.getLibrary().selectedModelId
  }

  /**
   * Resolves the provider backing a model step. Without a stored profile the
   * global selection answers; with one, a missing configuration is an error
   * rather than a silent fallback, so a stale profile never reroutes traffic.
   */
  resolveForSession(storedProfile: ExecutionProfileSnapshot | null): ModelSelection {
    const configuration = storedProfile
      ? this.getChatConfigurationForModelEntry(storedProfile.modelEntryId)
      : this.getSelectedChatConfiguration()
    if (!configuration) throw new ModelSelectionError()
    const modelEntryId =
      storedProfile?.modelEntryId ?? this.getSelectedModelEntryId() ?? configuration.modelId
    const provider = this.#resolveProvider(modelEntryId)
    if (!provider) throw new ModelSelectionError()
    return { provider, configuration, modelEntryId }
  }

  /**
   * Resolves the provider for a retry against the profile the original run
   * used. The provider id, model id, and sanitized configuration digest must
   * still match, so recovery cannot silently run on different settings.
   */
  resolveForProfile(profile: ExecutionProfileSnapshot): ModelSelection {
    const configuration = this.getChatConfigurationForModelEntry(profile.modelEntryId)
    if (!configuration)
      throw new ModelSelectionError(
        'The original model is unavailable. Restore its provider settings before retrying this turn.'
      )
    const current = this.toProfile(configuration, profile.modelEntryId, profile.thinkingEffort)
    if (
      current.providerId !== profile.providerId ||
      current.modelId !== profile.modelId ||
      current.configurationDigest !== profile.configurationDigest
    )
      throw new ModelSelectionError(
        'The original provider configuration changed. Restore its endpoint and model settings before retrying this turn.'
      )
    const provider = this.#resolveProvider(profile.modelEntryId)
    if (!provider)
      throw new ModelSelectionError(
        'The original model is unavailable. Restore its provider settings before retrying this turn.'
      )
    return { provider, configuration, modelEntryId: profile.modelEntryId }
  }

  getCapabilities(modelEntryId?: string | null): Promise<ModelReasoningCapabilities | null> {
    const selectedEntryId = modelEntryId ?? this.getSelectedModelEntryId()
    return (
      this.#resolveProvider(selectedEntryId ?? undefined)?.getModelCapabilities() ??
      Promise.resolve(null)
    )
  }

  toProfile(
    configuration: ChatProviderConfiguration,
    modelEntryId: string,
    thinkingEffort: ExecutionProfileSnapshot['thinkingEffort']
  ): ExecutionProfileSnapshot {
    const safeConfiguration = { ...configuration }
    if ('apiKey' in safeConfiguration) delete safeConfiguration.apiKey
    return {
      modelEntryId,
      providerId: configuration.provider,
      modelId: configuration.modelId,
      thinkingEffort,
      configurationDigest: createHash('sha256')
        .update(JSON.stringify(safeConfiguration))
        .digest('hex')
    }
  }
}

export type { ModelsDependencies }
export { Models }
