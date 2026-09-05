import * as z from 'zod'

import { defineSchema } from '../define'

const ProviderIdSchema = defineSchema(
  z.enum(['lm-studio', 'ollama', 'openai-responses', 'openai-compatible', 'anthropic-compatible'])
)
const ModelProviderSchema = defineSchema(z.string().trim().min(1))
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
const ProviderHeadersSchema = defineSchema(z.record(z.string(), z.string()))
const ProviderMaxTokensSchema = defineSchema(z.number().int().positive())
const CustomProviderIdSchema = defineSchema(z.string().trim().min(1))
const CustomProviderIconSchema = defineSchema(
  z
    .string()
    .regex(
      /^(?:default|cloud|server|terminal|[a-z0-9]+(?:-[a-z0-9]+)*)$/,
      'Custom provider icon must be a supported icon identifier.'
    )
)
const CustomProviderApiFormatSchema = defineSchema(
  z.enum(['openai-compatible', 'openai-responses', 'anthropic-compatible'])
)
const CustomProviderSchema = defineSchema(
  z.object({
    apiFormat: CustomProviderApiFormatSchema,
    apiKey: ProviderApiKeySchema.optional(),
    baseUrl: ProviderBaseUrlSchema,
    enabled: z.boolean().optional(),
    headers: z.record(z.string(), z.string()),
    icon: CustomProviderIconSchema,
    id: CustomProviderIdSchema,
    name: z.string().trim().min(1),
    useMaxCompletionTokens: z.boolean()
  })
)
const ProviderConfigurationSchema = defineSchema(
  z.discriminatedUnion('provider', [
    z.object({
      provider: z.literal('lm-studio'),
      baseUrl: ProviderBaseUrlSchema,
      apiKey: ProviderApiKeySchema.optional(),
      enabled: z.boolean().optional(),
      headers: ProviderHeadersSchema.optional()
    }),
    z.object({
      provider: z.literal('ollama'),
      baseUrl: ProviderBaseUrlSchema,
      enabled: z.boolean().optional(),
      headers: ProviderHeadersSchema.optional()
    }),
    z.object({
      provider: z.literal('openai-responses'),
      baseUrl: ProviderBaseUrlSchema,
      apiKey: ProviderApiKeySchema.optional(),
      enabled: z.boolean().optional(),
      headers: ProviderHeadersSchema.optional()
    }),
    z.object({
      provider: z.literal('openai-compatible'),
      baseUrl: ProviderBaseUrlSchema,
      apiKey: ProviderApiKeySchema.optional(),
      enabled: z.boolean().optional(),
      headers: ProviderHeadersSchema.optional(),
      useMaxCompletionTokens: z.boolean().optional()
    }),
    z.object({
      provider: z.literal('anthropic-compatible'),
      baseUrl: ProviderBaseUrlSchema,
      apiKey: ProviderApiKeySchema.optional(),
      enabled: z.boolean().optional(),
      headers: ProviderHeadersSchema.optional(),
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
    provider: ModelProviderSchema,
    modelId: ProviderModelIdSchema,
    displayName: ModelDisplayNameSchema,
    enabled: z.boolean().default(false)
  })
)
const ProviderLibrarySchema = defineSchema(
  z
    .object({
      configurations: z.array(ProviderConfigurationSchema),
      customProviders: z.array(CustomProviderSchema).default([]),
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
  customProvider: CustomProviderSchema,
  customProviderApiFormat: CustomProviderApiFormatSchema,
  customProviderIcon: CustomProviderIconSchema,
  customProviderId: CustomProviderIdSchema,
  modelEntry: ModelEntrySchema,
  modelEntryId: ModelEntryIdSchema,
  providerBaseUrl: ProviderBaseUrlSchema,
  providerApiKey: ProviderApiKeySchema,
  providerConfiguration: ProviderConfigurationSchema,
  providerHeaders: ProviderHeadersSchema,
  providerId: ProviderIdSchema,
  modelProvider: ModelProviderSchema,
  providerLibrary: ProviderLibrarySchema,
  providerMaxTokens: ProviderMaxTokensSchema,
  providerModelId: ProviderModelIdSchema
}

type ModelEntry = z.infer<typeof ModelEntrySchema>
type CustomProvider = z.infer<typeof CustomProviderSchema>
type ProviderConfiguration = z.infer<typeof ProviderConfigurationSchema>
type ProviderId = z.infer<typeof ProviderIdSchema>
type ProviderLibrary = z.infer<typeof ProviderLibrarySchema>

export {
  ModelDisplayNameSchema,
  CustomProviderApiFormatSchema,
  CustomProviderIconSchema,
  CustomProviderIdSchema,
  CustomProviderSchema,
  ModelEntryIdSchema,
  ModelEntrySchema,
  ProviderBaseUrlSchema,
  ProviderApiKeySchema,
  ProviderConfigurationSchema,
  ProviderHeadersSchema,
  ProviderIdSchema,
  ModelProviderSchema,
  ProviderLibrarySchema,
  ProviderMaxTokensSchema,
  ProviderModelIdSchema,
  providerDataSchemas
}
export type { CustomProvider, ModelEntry, ProviderConfiguration, ProviderId, ProviderLibrary }
