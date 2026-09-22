import type {
  ChatProviderConfiguration,
  ChatProviderMessage,
  DiscoveredModel
} from '@mico/ai-providers'

import { createChatProvider, discoverModels } from '@mico/ai-providers'
import type {
  CustomProvider,
  ModelEntry,
  ProviderConfiguration,
  ProviderLibrary
} from '@shared/data/schemas/provider'
import { CustomProviderSchema, ProviderHeadersSchema } from '@shared/data/schemas/provider'
import type {
  AddModelRequest,
  SyncModelsRequest,
  TestModelRequest
} from '@shared/ipc/schemas/providers'
import { and, eq } from 'drizzle-orm'
import { ProviderDatabase } from '../../data/provider-database'
import { providerLibraryState, providerModels, providers } from '../../data/provider-schema'

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
      enabledProviderIds: sortProviders(providerRows)
        .filter(({ enabled }) => enabled)
        .map(({ id }) => id),
      models: sortModels(database.select().from(providerModels).all()).map(
        ({ displayName, enabled, id, modelId, providerId }) => ({
          id,
          provider: providerId,
          modelId,
          displayName,
          enabled
        })
      ),
      selectedModelId: state?.selectedModelId ?? null,
      selectedProviderId: state?.selectedProviderId ?? null
    }
  }

  async saveLibrary(library: ProviderLibrary): Promise<ProviderLibrary> {
    const database = this.dependencies.database
    // Selections are sanitized here, at the single write path: a snapshot may
    // arrive with a selection that its own removal already invalidated.
    const selectedProviderId = sanitizeSelection(library.selectedProviderId, [
      ...library.configurations.map(({ provider }) => provider),
      ...library.customProviders.map(({ id }) => id)
    ])
    const selectedModelId = sanitizeSelection(
      library.selectedModelId,
      library.models.map(({ id }) => id)
    )
    const enabledProviderOrders = new Map(
      library.enabledProviderIds.map((providerId, index) => [providerId, index])
    )
    const modelOrders = new Map<string, number>()
    const enabledModelOrders = new Map<string, number>()
    for (const [index, model] of library.models.entries()) {
      modelOrders.set(model.id, index)
      if (model.enabled) enabledModelOrders.set(model.id, enabledModelOrders.size)
    }

    database.connection.transaction(() => {
      database.db.delete(providerModels).run()
      database.db.delete(providers).run()

      const providerRows = [
        ...library.configurations.map((configuration) => ({
          ...toProviderValues(configuration),
          id: configuration.provider,
          kind: 'builtin' as const,
          enabledOrder: enabledProviderOrders.get(configuration.provider) ?? null
        })),
        ...library.customProviders.map((provider) => ({
          ...toCustomProviderValues(provider),
          enabledOrder: enabledProviderOrders.get(provider.id) ?? null
        }))
      ]
      if (providerRows.length) database.db.insert(providers).values(providerRows).run()

      if (library.models.length)
        database.db
          .insert(providerModels)
          .values(
            library.models.map((model) => ({
              id: model.id,
              providerId: model.provider,
              modelId: model.modelId,
              displayName: model.displayName,
              enabled: model.enabled,
              discoveryOrder: modelOrders.get(model.id) ?? 0,
              enabledOrder: enabledModelOrders.get(model.id) ?? null
            }))
          )
          .run()

      database.db
        .update(providerLibraryState)
        .set({ selectedModelId, selectedProviderId })
        .where(eq(providerLibraryState.id, 1))
        .run()
    })()

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

  async syncModels({ models, provider }: SyncModelsRequest): Promise<void> {
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
  }

  async addModel(model: AddModelRequest): Promise<ModelEntry> {
    const database = this.dependencies.database.db
    const existing = database
      .select()
      .from(providerModels)
      .where(
        and(
          eq(providerModels.providerId, model.provider),
          eq(providerModels.modelId, model.modelId)
        )
      )
      .get()
    if (existing) return toModelEntry(existing)

    database
      .insert(providerModels)
      .values({
        id: this.dependencies.createId(),
        providerId: model.provider,
        modelId: model.modelId,
        displayName: model.displayName ?? model.modelId,
        enabled: false,
        // New manual entries lead the inactive list, making the next activation easy to find.
        discoveryOrder: getFirstDiscoveryOrder(database, model.provider),
        enabledOrder: null
      })
      .run()
    const saved = database
      .select()
      .from(providerModels)
      .where(
        and(
          eq(providerModels.providerId, model.provider),
          eq(providerModels.modelId, model.modelId)
        )
      )
      .get()
    if (!saved) throw new Error('Provider model was not saved.')
    return toModelEntry(saved)
  }

  getSelectedChatConfiguration(): ChatProviderConfiguration | null {
    const library = this.getLibrary()
    const model = library.models.find(({ id }) => id === library.selectedModelId)
    return model ? this.getChatConfigurationForModelEntry(model.id) : null
  }

  getChatConfigurationForModelEntry(modelEntryId: string): ChatProviderConfiguration | null {
    const library = this.getLibrary()
    const model = library.models.find(({ id }) => id === modelEntryId)
    if (!model?.enabled) return null

    const configuration = library.configurations.find(
      ({ enabled, provider }) => enabled && provider === model.provider
    )
    if (configuration) return toChatProviderConfiguration(configuration, model)

    const customProvider = library.customProviders.find(
      ({ enabled, id }) => enabled && id === model.provider
    )
    return customProvider
      ? toChatProviderConfiguration(toCustomProviderConfiguration(customProvider), model)
      : null
  }
}

function toConfiguration(row: typeof providers.$inferSelect): ProviderConfiguration {
  const headers = parseHeaders(row.headers)
  switch (row.id) {
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

/** Returns the selection when it still exists among the given ids, else null. */
function sanitizeSelection(selection: string | null, existingIds: string[]): string | null {
  return selection !== null && existingIds.includes(selection) ? selection : null
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
    name: null
  }
}

function toCustomProvider(row: typeof providers.$inferSelect): CustomProvider {
  if (!row.apiFormat || !row.icon || !row.name)
    throw new Error(`Custom provider '${row.id}' is incomplete.`)
  return CustomProviderSchema.parse({
    apiFormat: row.apiFormat,
    apiKey: row.apiKey ?? undefined,
    baseUrl: row.baseUrl,
    enabled: row.enabled,
    headers: parseHeaders(row.headers),
    icon: row.icon,
    id: row.id,
    name: row.name
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
    name: provider.name
  }
}

function toCustomProviderConfiguration(provider: CustomProvider): ProviderConfiguration {
  switch (provider.apiFormat) {
    case 'openai-compatible': {
      const configuration: Extract<ProviderConfiguration, { provider: 'openai-compatible' }> = {
        provider: 'openai-compatible',
        baseUrl: provider.baseUrl,
        headers: provider.headers
      }
      if (provider.apiKey) configuration.apiKey = provider.apiKey
      return configuration
    }
    case 'openai-responses': {
      const configuration: Extract<ProviderConfiguration, { provider: 'openai-responses' }> = {
        provider: 'openai-responses',
        baseUrl: provider.baseUrl,
        headers: provider.headers
      }
      if (provider.apiKey) configuration.apiKey = provider.apiKey
      return configuration
    }
    case 'anthropic-compatible': {
      const configuration: Extract<ProviderConfiguration, { provider: 'anthropic-compatible' }> = {
        provider: 'anthropic-compatible',
        baseUrl: provider.baseUrl,
        headers: provider.headers
      }
      if (provider.apiKey) configuration.apiKey = provider.apiKey
      return configuration
    }
  }
}

function toModelEntry(model: typeof providerModels.$inferSelect): ModelEntry {
  return {
    id: model.id,
    provider: model.providerId,
    modelId: model.modelId,
    displayName: model.displayName,
    enabled: model.enabled
  }
}

function getFirstDiscoveryOrder(database: ProviderDatabase['db'], providerId: string): number {
  const discoveryOrders = database
    .select({ discoveryOrder: providerModels.discoveryOrder })
    .from(providerModels)
    .where(eq(providerModels.providerId, providerId))
    .all()
  return Math.min(0, ...discoveryOrders.map(({ discoveryOrder }) => discoveryOrder)) - 1
}

function sortProviders(providerRows: Array<typeof providers.$inferSelect>) {
  return [...providerRows].sort((left, right) => {
    if (left.enabled && right.enabled)
      return (
        (left.enabledOrder ?? Number.MAX_SAFE_INTEGER) -
        (right.enabledOrder ?? Number.MAX_SAFE_INTEGER)
      )
    if (left.enabled) return -1
    if (right.enabled) return 1
    return 0
  })
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

export type { ProviderServiceDependencies }
export { ProviderService }
