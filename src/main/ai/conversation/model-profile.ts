import {
  type ChatProvider,
  type ChatProviderConfiguration,
  type ModelReasoningCapabilities,
  resolveThinkingSelection
} from '@mico/ai-providers'
import type { ExecutionProfileSnapshot } from '@shared/data/schemas/session'
import { type Models, ModelSelectionError, type ModelSelection } from '../models'
import type { SessionRuntimeService } from './runtime'

type SessionModelProfileDependencies = {
  models: Pick<
    Models,
    | 'resolveForSession'
    | 'resolveForProfile'
    | 'toProfile'
    | 'getCapabilities'
    | 'getChatConfigurationForModelEntry'
  >
  runtime: Pick<SessionRuntimeService, 'getDefaultProfile' | 'updateDefaultProfile'>
}

/** Owns session profile persistence; model selection and configuration identity belong to Models. */
class SessionModelProfile {
  constructor(private readonly dependencies: SessionModelProfileDependencies) {}

  resolveForSession(sessionId: string): ModelSelection {
    return this.dependencies.models.resolveForSession(
      this.dependencies.runtime.getDefaultProfile(sessionId)
    )
  }

  resolveForProfile(profile: ExecutionProfileSnapshot): ModelSelection {
    return this.dependencies.models.resolveForProfile(profile)
  }

  getCapabilities(sessionId?: string): Promise<ModelReasoningCapabilities | null> {
    const modelEntryId = sessionId
      ? this.dependencies.runtime.getDefaultProfile(sessionId)?.modelEntryId
      : undefined
    return this.dependencies.models.getCapabilities(modelEntryId)
  }

  toProfile(
    configuration: ChatProviderConfiguration,
    modelEntryId: string,
    thinkingEffort: ExecutionProfileSnapshot['thinkingEffort']
  ): ExecutionProfileSnapshot {
    return this.dependencies.models.toProfile(configuration, modelEntryId, thinkingEffort)
  }

  persistSessionProfile(sessionId: string, profile: ExecutionProfileSnapshot): void {
    this.dependencies.runtime.updateDefaultProfile(sessionId, profile)
  }

  updateSessionThinkingEffort(
    sessionId: string,
    thinkingEffort: ExecutionProfileSnapshot['thinkingEffort']
  ): void {
    const profile = this.dependencies.runtime.getDefaultProfile(sessionId)
    if (!profile)
      throw new ModelSelectionError('Select an enabled model for this session before chatting.')
    const configuration = this.dependencies.models.getChatConfigurationForModelEntry(
      profile.modelEntryId
    )
    if (!configuration) throw new ModelSelectionError()
    this.persistSessionProfile(
      sessionId,
      this.toProfile(configuration, profile.modelEntryId, thinkingEffort)
    )
  }

  updateSessionModelEntry(sessionId: string, modelEntryId: string): void {
    const configuration = this.dependencies.models.getChatConfigurationForModelEntry(modelEntryId)
    if (!configuration) throw new ModelSelectionError()
    const thinkingEffort =
      this.dependencies.runtime.getDefaultProfile(sessionId)?.thinkingEffort ?? 'default'
    this.persistSessionProfile(
      sessionId,
      this.toProfile(configuration, modelEntryId, thinkingEffort)
    )
  }
}

async function resolveEffectiveThinkingEffort(
  provider: ChatProvider,
  requestedThinkingEffort: ExecutionProfileSnapshot['thinkingEffort']
): Promise<ExecutionProfileSnapshot['thinkingEffort']> {
  try {
    return resolveThinkingSelection(requestedThinkingEffort, await provider.getModelCapabilities())
  } catch {
    return 'default'
  }
}

export { resolveEffectiveThinkingEffort, SessionModelProfile }
