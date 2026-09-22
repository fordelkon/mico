import * as z from 'zod'

import {
  ModelDisplayNameSchema,
  ProviderConfigurationSchema,
  ModelProviderSchema,
  ProviderModelIdSchema
} from '../../data/schemas/provider'
import type {
  ModelEntry,
  ProviderConfiguration,
  ProviderId,
  ProviderLibrary
} from '../../data/schemas/provider'

const DiscoveredModelSchema = z.object({
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
const TestModelRequestSchema = z.object({
  configuration: ProviderConfigurationSchema,
  modelId: ProviderModelIdSchema
})

interface ProvidersAPI {
  getLibrary: () => Promise<ProviderLibrary>
  saveLibrary: (library: ProviderLibrary) => Promise<ProviderLibrary>
  discoverModels: (configuration: ProviderConfiguration) => Promise<DiscoveredModel[]>
  addModel: (model: AddModelRequest) => Promise<ModelEntry>
  syncModels: (models: SyncModelsRequest) => Promise<void>
  testModel: (model: TestModelRequest) => Promise<void>
}

type AddModelRequest = z.infer<typeof AddModelRequestSchema>
type DiscoveredModel = z.infer<typeof DiscoveredModelSchema>
type SyncModelsRequest = z.infer<typeof SyncModelsRequestSchema>
type TestModelRequest = z.infer<typeof TestModelRequestSchema>

export {
  AddModelRequestSchema,
  DiscoveredModelSchema,
  SyncModelsRequestSchema,
  TestModelRequestSchema,
  type ProvidersAPI
}
export type {
  AddModelRequest,
  DiscoveredModel,
  SyncModelsRequest,
  TestModelRequest,
  ModelEntry,
  ProviderConfiguration,
  ProviderId,
  ProviderLibrary
}
