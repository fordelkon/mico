import { IpcChannel } from '../../IpcChannel'
import type { IpcMethod } from '../contracts'
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
  getLibrary: IpcMethod<IpcChannel.Providers_GetLibrary>
  saveLibrary: IpcMethod<IpcChannel.Providers_SaveLibrary>
  discoverModels: IpcMethod<IpcChannel.Providers_DiscoverModels>
  addModel: IpcMethod<IpcChannel.Providers_AddModel>
  syncModels: IpcMethod<IpcChannel.Providers_SyncModels>
  testModel: IpcMethod<IpcChannel.Providers_TestModel>
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
