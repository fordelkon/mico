import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const providers = sqliteTable('providers', {
  id: text().primaryKey(),
  kind: text({ enum: ['builtin', 'custom'] }).notNull(),
  apiFormat: text('api_format'),
  apiKey: text('api_key'),
  baseUrl: text('base_url').notNull(),
  enabled: integer({ mode: 'boolean' }).notNull().default(false),
  headers: text().notNull().default('{}'),
  icon: text(),
  maxTokens: integer('max_tokens'),
  name: text(),
  useMaxCompletionTokens: integer('use_max_completion_tokens', { mode: 'boolean' })
})

const providerModels = sqliteTable(
  'provider_models',
  {
    id: text().primaryKey(),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    modelId: text('model_id').notNull(),
    displayName: text('display_name').notNull(),
    enabled: integer({ mode: 'boolean' }).notNull().default(false),
    discoveryOrder: integer('discovery_order').notNull().default(0),
    enabledOrder: integer('enabled_order')
  },
  (table) => [uniqueIndex('provider_models_provider_model').on(table.providerId, table.modelId)]
)

const providerLibraryState = sqliteTable('provider_library_state', {
  id: integer().primaryKey(),
  selectedModelId: text('selected_model_id'),
  selectedProviderId: text('selected_provider_id')
})

export { providerLibraryState, providerModels, providers }
