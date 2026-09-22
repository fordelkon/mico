import * as z from 'zod'

import {
  CustomProviderSchema,
  ModelDisplayNameSchema,
  ModelEntryIdSchema,
  ProviderConfigurationSchema,
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
