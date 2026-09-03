import * as z from 'zod'

import { defineSchema } from '../define'

const ProviderIdSchema = defineSchema(
  z.enum(['lm-studio', 'ollama', 'openai-responses', 'openai-compatible', 'anthropic-compatible'])
)
const ProviderBaseUrlSchema = defineSchema(
  z
    .url()
    .refine(
      (value) => new URL(value).protocol === 'http:' || new URL(value).protocol === 'https:',
      {
        message: 'Base URL must use HTTP or HTTPS.'
      }
    )
)
const ProviderApiKeySchema = defineSchema(z.string().trim().min(1))
const ProviderMaxTokensSchema = defineSchema(z.number().int().positive())
const ProviderConfigurationSchema = defineSchema(
  z.discriminatedUnion('provider', [
    z.object({
      provider: z.literal('lm-studio'),
      baseUrl: ProviderBaseUrlSchema,
      apiKey: ProviderApiKeySchema.optional()
    }),
    z.object({ provider: z.literal('ollama'), baseUrl: ProviderBaseUrlSchema }),
    z.object({
      provider: z.literal('openai-responses'),
      baseUrl: ProviderBaseUrlSchema,
      apiKey: ProviderApiKeySchema
    }),
    z.object({
      provider: z.literal('openai-compatible'),
      baseUrl: ProviderBaseUrlSchema,
      apiKey: ProviderApiKeySchema.optional()
    }),
    z.object({
      provider: z.literal('anthropic-compatible'),
      baseUrl: ProviderBaseUrlSchema,
      apiKey: ProviderApiKeySchema,
      maxTokens: ProviderMaxTokensSchema.optional()
    })
  ])
)
const ModelEntryIdSchema = defineSchema(z.string().trim().min(1))
const ProviderModelIdSchema = defineSchema(z.string().trim().min(1))
const ModelDisplayNameSchema = defineSchema(z.string().trim().min(1))
const ModelEntrySchema = defineSchema(
  z.object({
    id: ModelEntryIdSchema,
    provider: ProviderIdSchema,
    modelId: ProviderModelIdSchema,
    displayName: ModelDisplayNameSchema
  })
)
const ProviderLibrarySchema = defineSchema(
  z
    .object({
      configurations: z.array(ProviderConfigurationSchema),
      models: z.array(ModelEntrySchema),
      selectedModelId: ModelEntryIdSchema.nullable()
    })
    .refine(
      ({ models, selectedModelId }) =>
        selectedModelId === null || models.some(({ id }) => id === selectedModelId),
      { message: 'Selected model must exist in the library.', path: ['selectedModelId'] }
    )
)

const providerDataSchemas = {
  modelDisplayName: ModelDisplayNameSchema,
  modelEntry: ModelEntrySchema,
  modelEntryId: ModelEntryIdSchema,
  providerBaseUrl: ProviderBaseUrlSchema,
  providerApiKey: ProviderApiKeySchema,
  providerConfiguration: ProviderConfigurationSchema,
  providerId: ProviderIdSchema,
  providerLibrary: ProviderLibrarySchema,
  providerMaxTokens: ProviderMaxTokensSchema,
  providerModelId: ProviderModelIdSchema
}

type ModelEntry = z.infer<typeof ModelEntrySchema>
type ProviderConfiguration = z.infer<typeof ProviderConfigurationSchema>
type ProviderId = z.infer<typeof ProviderIdSchema>
type ProviderLibrary = z.infer<typeof ProviderLibrarySchema>

export {
  ModelDisplayNameSchema,
  ModelEntryIdSchema,
  ModelEntrySchema,
  ProviderBaseUrlSchema,
  ProviderApiKeySchema,
  ProviderConfigurationSchema,
  ProviderIdSchema,
  ProviderLibrarySchema,
  ProviderMaxTokensSchema,
  ProviderModelIdSchema,
  providerDataSchemas
}
export type { ModelEntry, ProviderConfiguration, ProviderId, ProviderLibrary }
