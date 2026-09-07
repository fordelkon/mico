import * as z from 'zod'

import {
  CustomProviderSchema,
  CustomProviderIdSchema,
  ModelDisplayNameSchema,
  ModelEntryIdSchema,
  ModelEntrySchema,
  ProviderConfigurationSchema,
  ProviderLibrarySchema,
  ModelProviderSchema,
  ProviderModelIdSchema
} from '../../data/schemas/provider'
import type {
  CustomProvider,
  ModelEntry,
  ProviderConfiguration,
  ProviderId,
  ProviderLibrary
} from '../../data/schemas/provider'
import { defineRoute } from '../define'

const DiscoveredModelSchema = z.object({
  modelId: ProviderModelIdSchema,
  displayName: ModelDisplayNameSchema
})
const ImportModelRequestSchema = z.object({
  provider: ModelProviderSchema,
  modelId: ProviderModelIdSchema,
  displayName: ModelDisplayNameSchema
})
const AddModelRequestSchema = z.object({
  provider: ModelProviderSchema,
  modelId: ProviderModelIdSchema,
  displayName: ModelDisplayNameSchema.optional()
})
const SyncModelsRequestSchema = z.object({
  provider: ModelProviderSchema,
  models: z.array(DiscoveredModelSchema)
})
const SetModelEnabledRequestSchema = z.object({
  modelId: ModelEntryIdSchema,
  enabled: z.boolean()
})
const SelectProviderRequestSchema = ModelProviderSchema.nullable()
const TestModelRequestSchema = z.object({
  configuration: ProviderConfigurationSchema,
  modelId: ProviderModelIdSchema
})
const AddCustomProviderRequestSchema = CustomProviderSchema.omit({ id: true })
const UpdateCustomProviderRequestSchema = CustomProviderSchema

interface ProvidersAPI {
  addCustomProvider: (provider: AddCustomProviderRequest) => Promise<CustomProvider>
  updateCustomProvider: (provider: UpdateCustomProviderRequest) => Promise<CustomProvider>
  removeCustomProvider: (providerId: string) => Promise<void>
  getLibrary: () => Promise<ProviderLibrary>
  saveLibrary: (library: ProviderLibrary) => Promise<ProviderLibrary>
  saveConfiguration: (configuration: ProviderConfiguration) => Promise<ProviderConfiguration>
  discoverModels: (configuration: ProviderConfiguration) => Promise<DiscoveredModel[]>
  importModel: (model: ImportModelRequest) => Promise<ModelEntry>
  addModel: (model: AddModelRequest) => Promise<ModelEntry>
  setModelEnabled: (model: SetModelEnabledRequest) => Promise<ModelEntry>
  syncModels: (models: SyncModelsRequest) => Promise<void>
  testModel: (model: TestModelRequest) => Promise<void>
  removeModel: (modelId: string) => Promise<void>
  selectModel: (modelId: string | null) => Promise<string | null>
  selectProvider: (providerId: string | null) => Promise<string | null>
}

const providersRequestSchemas = {
  'providers.add-custom-provider': defineRoute({
    input: AddCustomProviderRequestSchema,
    output: CustomProviderSchema
  }),
  'providers.add-model': defineRoute({
    input: AddModelRequestSchema,
    output: ModelEntrySchema
  }),
  'providers.update-custom-provider': defineRoute({
    input: UpdateCustomProviderRequestSchema,
    output: CustomProviderSchema
  }),
  'providers.remove-custom-provider': defineRoute({
    input: CustomProviderIdSchema,
    output: z.void()
  }),
  'providers.discover-models': defineRoute({
    input: ProviderConfigurationSchema,
    output: z.array(DiscoveredModelSchema)
  }),
  'providers.get-library': defineRoute({ input: z.void(), output: ProviderLibrarySchema }),
  'providers.save-library': defineRoute({
    input: ProviderLibrarySchema,
    output: ProviderLibrarySchema
  }),
  'providers.import-model': defineRoute({
    input: ImportModelRequestSchema,
    output: ModelEntrySchema
  }),
  'providers.set-model-enabled': defineRoute({
    input: SetModelEnabledRequestSchema,
    output: ModelEntrySchema
  }),
  'providers.sync-models': defineRoute({
    input: SyncModelsRequestSchema,
    output: z.void()
  }),
  'providers.remove-model': defineRoute({
    input: ModelEntryIdSchema,
    output: z.void()
  }),
  'providers.save-configuration': defineRoute({
    input: ProviderConfigurationSchema,
    output: ProviderConfigurationSchema
  }),
  'providers.select-model': defineRoute({
    input: ModelEntryIdSchema.nullable(),
    output: ModelEntryIdSchema.nullable()
  }),
  'providers.select-provider': defineRoute({
    input: SelectProviderRequestSchema,
    output: SelectProviderRequestSchema
  }),
  'providers.test-model': defineRoute({ input: TestModelRequestSchema, output: z.void() })
}

type AddModelRequest = z.infer<typeof AddModelRequestSchema>
type AddCustomProviderRequest = z.infer<typeof AddCustomProviderRequestSchema>
type DiscoveredModel = z.infer<typeof DiscoveredModelSchema>
type ImportModelRequest = z.infer<typeof ImportModelRequestSchema>
type SetModelEnabledRequest = z.infer<typeof SetModelEnabledRequestSchema>
type SyncModelsRequest = z.infer<typeof SyncModelsRequestSchema>
type TestModelRequest = z.infer<typeof TestModelRequestSchema>
type UpdateCustomProviderRequest = z.infer<typeof UpdateCustomProviderRequestSchema>

export {
  AddModelRequestSchema,
  AddCustomProviderRequestSchema,
  UpdateCustomProviderRequestSchema,
  DiscoveredModelSchema,
  ImportModelRequestSchema,
  SetModelEnabledRequestSchema,
  SelectProviderRequestSchema,
  SyncModelsRequestSchema,
  TestModelRequestSchema,
  providersRequestSchemas,
  type ProvidersAPI
}
export type {
  AddModelRequest,
  AddCustomProviderRequest,
  UpdateCustomProviderRequest,
  DiscoveredModel,
  ImportModelRequest,
  SetModelEnabledRequest,
  SyncModelsRequest,
  TestModelRequest,
  ModelEntry,
  ProviderConfiguration,
  ProviderId,
  ProviderLibrary
}
