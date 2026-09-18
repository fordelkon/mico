import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/** Provider connection configurations, including built-in and user-defined providers. */
const providers = sqliteTable('providers', {
  /** Stable provider identifier; provider_models.providerId refers to this key. */
  id: text().primaryKey(),
  kind: text({ enum: ['builtin', 'custom'] }).notNull(),
  apiFormat: text('api_format'),
  apiKey: text('api_key'),
  baseUrl: text('base_url').notNull(),
  enabled: integer({ mode: 'boolean' }).notNull().default(false),
  enabledOrder: integer('enabled_order'),
  headers: text().notNull().default('{}'),
  icon: text(),
  maxTokens: integer('max_tokens'),
  name: text(),
  useMaxCompletionTokens: integer('use_max_completion_tokens', { mode: 'boolean' })
})

/** Locally managed model entries belonging to provider configurations. */
const providerModels = sqliteTable(
  'provider_models',
  {
    /** Stable local model-entry ID used by selection and session execution profiles. */
    id: text().primaryKey(),
    /** Owning provider; deleting it removes all of its model entries. */
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    /** Provider-native model name, unique only within providerId. */
    modelId: text('model_id').notNull(),
    displayName: text('display_name').notNull(),
    enabled: integer({ mode: 'boolean' }).notNull().default(false),
    discoveryOrder: integer('discovery_order').notNull().default(0),
    enabledOrder: integer('enabled_order')
  },
  (table) => [uniqueIndex('provider_models_provider_model').on(table.providerId, table.modelId)]
)

/** Singleton row holding selections shared by the provider library. */
const providerLibraryState = sqliteTable('provider_library_state', {
  /** The service always creates and reads the sole state row as id = 1. */
  id: integer().primaryKey(),
  /** Selected provider_models.id, or null when no model is selected. */
  selectedModelId: text('selected_model_id'),
  /** Selected providers.id, or null when no provider is selected. */
  selectedProviderId: text('selected_provider_id')
})

export { providerLibraryState, providerModels, providers }
