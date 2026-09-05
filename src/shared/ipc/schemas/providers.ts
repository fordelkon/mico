import * as z from 'zod'

import {
  CustomProviderSchema,
  CustomProviderIdSchema,
  ModelDisplayNameSchema,
  ModelEntryIdSchema,
  ProviderConfigurationSchema,
  ProviderIdSchema,
  ProviderLibrarySchema,
  ProviderModelIdSchema
} from '../../data/schemas/provider'
import type {
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
  provider: ProviderIdSchema,
  modelId: ProviderModelIdSchema,
  displayName: ModelDisplayNameSchema
})
const AddModelRequestSchema = z.object({
  provider: ProviderIdSchema,
  modelId: ProviderModelIdSchema,
  displayName: ModelDisplayNameSchema.optional()
})
const TestModelRequestSchema = z.object({
  configuration: ProviderConfigurationSchema,
  modelId: ProviderModelIdSchema
})
const AddCustomProviderRequestSchema = CustomProviderSchema.omit({ id: true })
const UpdateCustomProviderRequestSchema = CustomProviderSchema

interface ProvidersAPI {
  addCustomProvider: (provider: AddCustomProviderRequest) => Promise<ProviderLibrary>
  updateCustomProvider: (provider: UpdateCustomProviderRequest) => Promise<ProviderLibrary>
  removeCustomProvider: (providerId: string) => Promise<ProviderLibrary>
  getLibrary: () => Promise<ProviderLibrary>
  saveConfiguration: (configuration: ProviderConfiguration) => Promise<ProviderLibrary>
  discoverModels: (configuration: ProviderConfiguration) => Promise<DiscoveredModel[]>
  importModel: (model: ImportModelRequest) => Promise<ProviderLibrary>
  addModel: (model: AddModelRequest) => Promise<ProviderLibrary>
  testModel: (model: TestModelRequest) => Promise<void>
  removeModel: (modelId: string) => Promise<ProviderLibrary>
  selectModel: (modelId: string | null) => Promise<ProviderLibrary>
}

const providersRequestSchemas = {
  'providers.add-custom-provider': defineRoute({
    input: AddCustomProviderRequestSchema,
    output: ProviderLibrarySchema
  }),
  'providers.add-model': defineRoute({
    input: AddModelRequestSchema,
    output: ProviderLibrarySchema
  }),
  'providers.update-custom-provider': defineRoute({
    input: UpdateCustomProviderRequestSchema,
    output: ProviderLibrarySchema
  }),
  'providers.remove-custom-provider': defineRoute({
    input: CustomProviderIdSchema,
    output: ProviderLibrarySchema
  }),
  'providers.discover-models': defineRoute({
    input: ProviderConfigurationSchema,
    output: z.array(DiscoveredModelSchema)
  }),
  'providers.get-library': defineRoute({ input: z.void(), output: ProviderLibrarySchema }),
  'providers.import-model': defineRoute({
    input: ImportModelRequestSchema,
    output: ProviderLibrarySchema
  }),
  'providers.remove-model': defineRoute({
    input: ModelEntryIdSchema,
    output: ProviderLibrarySchema
  }),
  'providers.save-configuration': defineRoute({
    input: ProviderConfigurationSchema,
    output: ProviderLibrarySchema
  }),
  'providers.select-model': defineRoute({
    input: ModelEntryIdSchema.nullable(),
    output: ProviderLibrarySchema
  }),
  'providers.test-model': defineRoute({ input: TestModelRequestSchema, output: z.void() })
}

type AddModelRequest = z.infer<typeof AddModelRequestSchema>
type AddCustomProviderRequest = z.infer<typeof AddCustomProviderRequestSchema>
type DiscoveredModel = z.infer<typeof DiscoveredModelSchema>
type ImportModelRequest = z.infer<typeof ImportModelRequestSchema>
type TestModelRequest = z.infer<typeof TestModelRequestSchema>
type UpdateCustomProviderRequest = z.infer<typeof UpdateCustomProviderRequestSchema>

export {
  AddModelRequestSchema,
  AddCustomProviderRequestSchema,
  UpdateCustomProviderRequestSchema,
  DiscoveredModelSchema,
  ImportModelRequestSchema,
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
  TestModelRequest,
  ModelEntry,
  ProviderConfiguration,
  ProviderId,
  ProviderLibrary
}
