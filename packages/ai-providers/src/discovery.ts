import { providerDescriptors } from './provider-registry'
import type { DiscoveredModel, ModelDiscoveryDependencies, ModelDiscoveryInput } from './contracts'

function normalizeModels(
  candidates: { modelId?: string; displayName?: string }[]
): DiscoveredModel[] {
  const seen = new Set<string>()
  return candidates.flatMap(({ modelId, displayName }) => {
    if (!modelId || seen.has(modelId)) return []
    seen.add(modelId)
    return [{ modelId, displayName: displayName ?? modelId }]
  })
}

async function discoverModels(
  input: ModelDiscoveryInput,
  dependencies: ModelDiscoveryDependencies = {}
): Promise<DiscoveredModel[]> {
  const descriptor = providerDescriptors[input.provider]
  const plan = descriptor.planModelDiscovery(input)
  const requestFetch = dependencies.fetch ?? fetch
  let response = await requestFetch(plan.url, { headers: plan.headers })
  if (plan.retryHeaders && response.status === 401)
    response = await requestFetch(plan.url, { headers: plan.retryHeaders })
  if (!response.ok)
    throw new Error(
      `${descriptor.displayName} model discovery failed (${response.status} ${response.statusText}).`
    )
  return normalizeModels(await descriptor.parseModels(response))
}

export { discoverModels }
