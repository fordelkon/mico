import { and, eq } from 'drizzle-orm'

import { createChatProvider, discoverModels } from '@mico/ai-providers'
import type {
  ChatProviderConfiguration,
  ChatProviderMessage,
  DiscoveredModel
} from '@mico/ai-providers'
import { ProviderDatabase } from '../data/provider-database'
import { providerLibraryState, providerModels, providers } from '../data/provider-schema'
import { CustomProviderSchema, ProviderHeadersSchema } from '@shared/data/schemas/provider'
import type {
  CustomProvider,
  ModelEntry,
  ProviderConfiguration,
  ProviderLibrary
} from '@shared/data/schemas/provider'
import type {
  AddModelRequest,
  ImportModelRequest,
  SetModelEnabledRequest,
  SyncModelsRequest,
  TestModelRequest
} from '@shared/ipc/schemas/providers'

type ProviderServiceDependencies = {
  createId?: () => string
  database?: ProviderDatabase
  discoverModels?: (configuration: ProviderConfiguration) => Promise<DiscoveredModel[]>
  testModel?: (
    configuration: ChatProviderConfiguration,
    messages: ChatProviderMessage[]
  ) => Promise<void>
}

const defaultDependencies: Required<ProviderServiceDependencies> = {
  createId: () => crypto.randomUUID(),
  database: new ProviderDatabase(),
  discoverModels,
  testModel: async (configuration, messages) => {
    const provider = createChatProvider(configuration)
    const stream = await provider.stream({
      conversationKey: 'provider-test',
      messages,
      thinkingEffort: 'default',
      signal: new AbortController().signal
    })
    for await (const _chunk of stream) {
      // Consume the complete stream so a successful result proves the model can respond.
    }
  }
}

class ProviderService {
  private readonly dependencies: Required<ProviderServiceDependencies>

  constructor(dependencies: ProviderServiceDependencies = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies }
  }

  async initialize(): Promise<void> {
    await this.dependencies.database.initialize()
  }

  getLibrary(): ProviderLibrary {
    const database = this.dependencies.database.db
    const state = database
      .select()
      .from(providerLibraryState)
      .where(eq(providerLibraryState.id, 1))
      .get()
    const providerRows = database.select().from(providers).all()
    return {
      configurations: providerRows.filter(({ kind }) => kind === 'builtin').map(toConfiguration),
      customProviders: providerRows.filter(({ kind }) => kind === 'custom').map(toCustomProvider),
      models: sortModels(database.select().from(providerModels).all()).map(
        ({ displayName, enabled, id, modelId, providerId }) => ({
          id,
          provider: providerId,
          modelId,
          displayName,
          enabled
        })
      ),
      selectedModelId: state?.selectedModelId ?? null
    }
  }

  async saveConfiguration(configuration: ProviderConfiguration): Promise<ProviderLibrary> {
    const values = {
      ...toProviderValues(configuration),
      id: configuration.provider,
      kind: 'builtin' as const
    }
    this.dependencies.database.db
      .insert(providers)
      .values(values)
      .onConflictDoUpdate({ target: providers.id, set: values })
      .run()
    return this.getLibrary()
  }

  async saveLibrary(library: ProviderLibrary): Promise<ProviderLibrary> {
    const database = this.dependencies.database
    database.connection.transaction(() => {
      database.db.delete(providerModels).run()
      database.db.delete(providers).run()
      if (library.configurations.length)
        database.db
          .insert(providers)
          .values(
            library.configurations.map((configuration) => ({
              ...toProviderValues(configuration),
              id: configuration.provider,
              kind: 'builtin' as const
            }))
          )
          .run()
      if (library.customProviders.length)
        database.db
          .insert(providers)
          .values(library.customProviders.map(toCustomProviderValues))
          .run()
      if (library.models.length)
        database.db.insert(providerModels).values(library.models.map(toModelValues)).run()
      database.db
        .update(providerLibraryState)
        .set({ selectedModelId: library.selectedModelId })
        .where(eq(providerLibraryState.id, 1))
        .run()
    })()
    return this.getLibrary()
  }

  async addCustomProvider(provider: Omit<CustomProvider, 'id'>): Promise<ProviderLibrary> {
    this.dependencies.database.db
      .insert(providers)
      .values(toCustomProviderValues({ id: this.dependencies.createId(), ...provider }))
      .run()
    return this.getLibrary()
  }

  async removeCustomProvider(providerId: string): Promise<ProviderLibrary> {
    const database = this.dependencies.database
    database.connection.transaction(() => {
      const modelIds = database.db
        .select({ id: providerModels.id })
        .from(providerModels)
        .where(eq(providerModels.providerId, providerId))
        .all()
        .map(({ id }) => id)
      database.db.delete(providers).where(eq(providers.id, providerId)).run()
      const state = database.db
        .select()
        .from(providerLibraryState)
        .where(eq(providerLibraryState.id, 1))
        .get()
      if (state?.selectedModelId && modelIds.includes(state.selectedModelId))
        database.db
          .update(providerLibraryState)
          .set({ selectedModelId: null })
          .where(eq(providerLibraryState.id, 1))
          .run()
    })()
    return this.getLibrary()
  }

  async updateCustomProvider(provider: CustomProvider): Promise<ProviderLibrary> {
    const updated = this.dependencies.database.db
      .update(providers)
      .set(toCustomProviderValues(provider))
      .where(and(eq(providers.id, provider.id), eq(providers.kind, 'custom')))
      .run()
    if (updated.changes === 0) throw new Error('Custom provider does not exist.')
    return this.getLibrary()
  }

  async discoverModels(configuration: ProviderConfiguration): Promise<DiscoveredModel[]> {
    return this.dependencies.discoverModels(configuration)
  }

  async testModel({ configuration, modelId }: TestModelRequest): Promise<void> {
    await this.dependencies.testModel(toChatProviderConfiguration(configuration, { modelId }), [
      { role: 'user', parts: [{ type: 'text', text: 'Reply with OK.' }] }
    ])
  }

  async importModel(model: ImportModelRequest): Promise<ProviderLibrary> {
    const database = this.dependencies.database.db
    const existing = database
      .select({ id: providerModels.id, enabled: providerModels.enabled })
      .from(providerModels)
      .where(
        and(
          eq(providerModels.providerId, model.provider),
          eq(providerModels.modelId, model.modelId)
        )
      )
      .get()
    const enabledOrder = getNextEnabledOrder(database)
    if (!existing)
      database
        .insert(providerModels)
        .values({
          id: this.dependencies.createId(),
          providerId: model.provider,
          modelId: model.modelId,
          displayName: model.displayName,
          enabled: true,
          discoveryOrder: getNextDiscoveryOrder(database, model.provider),
          enabledOrder
        })
        .run()
    else if (!existing.enabled)
      database
        .update(providerModels)
        .set({ enabled: true, enabledOrder })
        .where(eq(providerModels.id, existing.id))
        .run()
    return this.getLibrary()
  }

  async syncModels({ models, provider }: SyncModelsRequest): Promise<ProviderLibrary> {
    const database = this.dependencies.database
    database.connection.transaction(() => {
      const existingModels = database.db
        .select()
        .from(providerModels)
        .where(eq(providerModels.providerId, provider))
        .all()
      const existingByModelId = new Map(existingModels.map((model) => [model.modelId, model]))
      const fetchedModelIds = new Set(models.map(({ modelId }) => modelId))

      for (const model of existingModels) {
        if (!fetchedModelIds.has(model.modelId))
          database.db.delete(providerModels).where(eq(providerModels.id, model.id)).run()
      }
      for (const [discoveryOrder, model] of models.entries()) {
        const existing = existingByModelId.get(model.modelId)
        if (existing)
          database.db
            .update(providerModels)
            .set({ displayName: model.displayName, discoveryOrder })
            .where(eq(providerModels.id, existing.id))
            .run()
        else
          database.db
            .insert(providerModels)
            .values({
              id: this.dependencies.createId(),
              providerId: provider,
              modelId: model.modelId,
              displayName: model.displayName,
              enabled: false,
              discoveryOrder,
              enabledOrder: null
            })
            .run()
      }
      const state = database.db
        .select()
        .from(providerLibraryState)
        .where(eq(providerLibraryState.id, 1))
        .get()
      if (
        state?.selectedModelId &&
        existingModels.some(({ id }) => id === state.selectedModelId) &&
        !existingModels.some(
          ({ id, modelId }) => id === state.selectedModelId && fetchedModelIds.has(modelId)
        )
      )
        database.db
          .update(providerLibraryState)
          .set({ selectedModelId: null })
          .where(eq(providerLibraryState.id, 1))
          .run()
    })()
    return this.getLibrary()
  }

  async setModelEnabled({ enabled, modelId }: SetModelEnabledRequest): Promise<ProviderLibrary> {
    const database = this.dependencies.database
    database.connection.transaction(() => {
      const model = database.db
        .select()
        .from(providerModels)
        .where(eq(providerModels.id, modelId))
        .get()
      if (!model) throw new Error('Provider model does not exist in the library.')
      database.db
        .update(providerModels)
        .set({ enabled, enabledOrder: enabled ? getNextEnabledOrder(database.db) : null })
        .where(eq(providerModels.id, modelId))
        .run()
      if (!enabled)
        database.db
          .update(providerLibraryState)
          .set({ selectedModelId: null })
          .where(
            and(eq(providerLibraryState.id, 1), eq(providerLibraryState.selectedModelId, modelId))
          )
          .run()
    })()
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
    const database = this.dependencies.database
    database.connection.transaction(() => {
      database.db.delete(providerModels).where(eq(providerModels.id, modelId)).run()
      database.db
        .update(providerLibraryState)
        .set({ selectedModelId: null })
        .where(
          and(eq(providerLibraryState.id, 1), eq(providerLibraryState.selectedModelId, modelId))
        )
        .run()
    })()
    return this.getLibrary()
  }

  async selectModel(modelId: string | null): Promise<ProviderLibrary> {
    if (
      modelId !== null &&
      !this.dependencies.database.db
        .select({ id: providerModels.id })
        .from(providerModels)
        .where(eq(providerModels.id, modelId))
        .get()
    )
      throw new Error('Selected model does not exist in the library.')
    this.dependencies.database.db
      .update(providerLibraryState)
      .set({ selectedModelId: modelId })
      .where(eq(providerLibraryState.id, 1))
      .run()
    return this.getLibrary()
  }

  getSelectedChatConfiguration(): ChatProviderConfiguration | null {
    const library = this.getLibrary()
    const model = library.models.find(({ id }) => id === library.selectedModelId)
    const configuration = model
      ? library.configurations.find(({ provider }) => provider === model.provider)
      : undefined
    return model && configuration ? toChatProviderConfiguration(configuration, model) : null
  }
}

function toConfiguration(row: typeof providers.$inferSelect): ProviderConfiguration {
  const headers = parseHeaders(row.headers)
  switch (row.id) {
    case 'lm-studio': {
      const configuration: Extract<ProviderConfiguration, { provider: 'lm-studio' }> = {
        provider: 'lm-studio' as const,
        baseUrl: row.baseUrl,
        enabled: row.enabled
      }
      if (row.apiKey) configuration.apiKey = row.apiKey
      if (Object.keys(headers).length) configuration.headers = headers
      return configuration
    }
    case 'ollama': {
      const configuration: Extract<ProviderConfiguration, { provider: 'ollama' }> = {
        provider: 'ollama' as const,
        baseUrl: row.baseUrl,
        enabled: row.enabled
      }
      if (Object.keys(headers).length) configuration.headers = headers
      return configuration
    }
    case 'openai-responses': {
      const configuration: Extract<ProviderConfiguration, { provider: 'openai-responses' }> = {
        provider: 'openai-responses' as const,
        baseUrl: row.baseUrl,
        enabled: row.enabled
      }
      if (row.apiKey) configuration.apiKey = row.apiKey
      if (Object.keys(headers).length) configuration.headers = headers
      return configuration
    }
    case 'openai-compatible': {
      const configuration: Extract<ProviderConfiguration, { provider: 'openai-compatible' }> = {
        provider: 'openai-compatible' as const,
        baseUrl: row.baseUrl,
        enabled: row.enabled
      }
      if (row.apiKey) configuration.apiKey = row.apiKey
      if (Object.keys(headers).length) configuration.headers = headers
      if (row.useMaxCompletionTokens !== null)
        configuration.useMaxCompletionTokens = row.useMaxCompletionTokens
      return configuration
    }
    case 'anthropic-compatible': {
      const configuration: Extract<ProviderConfiguration, { provider: 'anthropic-compatible' }> = {
        provider: 'anthropic-compatible' as const,
        baseUrl: row.baseUrl,
        enabled: row.enabled
      }
      if (row.apiKey) configuration.apiKey = row.apiKey
      if (Object.keys(headers).length) configuration.headers = headers
      if (row.maxTokens !== null) configuration.maxTokens = row.maxTokens
      return configuration
    }
    default:
      throw new Error(`Unknown built-in provider '${row.id}'.`)
  }
}

function toProviderValues(configuration: ProviderConfiguration) {
  return {
    apiFormat: null,
    apiKey: 'apiKey' in configuration ? (configuration.apiKey ?? null) : null,
    baseUrl: configuration.baseUrl,
    enabled: configuration.enabled ?? false,
    headers: JSON.stringify(configuration.headers ?? {}),
    icon: null,
    maxTokens:
      configuration.provider === 'anthropic-compatible' ? (configuration.maxTokens ?? null) : null,
    name: null,
    useMaxCompletionTokens:
      configuration.provider === 'openai-compatible'
        ? (configuration.useMaxCompletionTokens ?? null)
        : null
  }
}

function toCustomProvider(row: typeof providers.$inferSelect): CustomProvider {
  if (!row.apiFormat || !row.icon || !row.name || row.useMaxCompletionTokens === null)
    throw new Error(`Custom provider '${row.id}' is incomplete.`)
  return CustomProviderSchema.parse({
    apiFormat: row.apiFormat,
    apiKey: row.apiKey ?? undefined,
    baseUrl: row.baseUrl,
    enabled: row.enabled,
    headers: parseHeaders(row.headers),
    icon: row.icon,
    id: row.id,
    name: row.name,
    useMaxCompletionTokens: row.useMaxCompletionTokens
  })
}

function toCustomProviderValues(provider: CustomProvider) {
  return {
    id: provider.id,
    kind: 'custom' as const,
    apiFormat: provider.apiFormat,
    apiKey: provider.apiKey ?? null,
    baseUrl: provider.baseUrl,
    enabled: provider.enabled ?? false,
    headers: JSON.stringify(provider.headers),
    icon: provider.icon,
    maxTokens: null,
    name: provider.name,
    useMaxCompletionTokens: provider.useMaxCompletionTokens
  }
}

function toModelValues(model: ModelEntry) {
  return {
    id: model.id,
    providerId: model.provider,
    modelId: model.modelId,
    displayName: model.displayName,
    enabled: model.enabled
  }
}

function getNextDiscoveryOrder(database: ProviderDatabase['db'], providerId: string): number {
  const discoveryOrders = database
    .select({ discoveryOrder: providerModels.discoveryOrder })
    .from(providerModels)
    .where(eq(providerModels.providerId, providerId))
    .all()
  return Math.max(-1, ...discoveryOrders.map(({ discoveryOrder }) => discoveryOrder)) + 1
}

function getNextEnabledOrder(database: ProviderDatabase['db']): number {
  const enabledOrders = database
    .select({ enabledOrder: providerModels.enabledOrder })
    .from(providerModels)
    .all()
  return Math.max(-1, ...enabledOrders.map(({ enabledOrder }) => enabledOrder ?? -1)) + 1
}

function sortModels(models: Array<typeof providerModels.$inferSelect>) {
  return [...models].sort((left, right) => {
    if (left.providerId !== right.providerId) return left.providerId.localeCompare(right.providerId)
    if (left.enabled && right.enabled) return (left.enabledOrder ?? 0) - (right.enabledOrder ?? 0)
    if (left.enabled) return -1
    if (right.enabled) return 1
    return left.discoveryOrder - right.discoveryOrder
  })
}

function parseHeaders(value: string): Record<string, string> {
  try {
    return ProviderHeadersSchema.safeParse(JSON.parse(value)).data ?? {}
  } catch {
    return {}
  }
}

function toChatProviderConfiguration(
  configuration: ProviderConfiguration,
  model: Pick<ModelEntry, 'modelId'>
): ChatProviderConfiguration {
  const { enabled: _enabled, ...connection } = configuration
  return { ...connection, modelId: model.modelId }
}

export { ProviderService }
export type { ProviderServiceDependencies }
