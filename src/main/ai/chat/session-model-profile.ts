import { createHash } from 'node:crypto'

import {
  type ChatProvider,
  type ChatProviderConfiguration,
  type ModelReasoningCapabilities,
  resolveThinkingSelection
} from '@mico/ai-providers'
import type { ExecutionProfileSnapshot } from '@shared/data/schemas/session'
import type { SessionRuntimeService } from '../sessions/session-runtime-service'
import type { ChatProviderResolver } from './chat-provider-resolver'
import { NoModelSelectedError } from './turn-failure'

type SessionModelProfileDependencies = {
  resolveProvider: ChatProviderResolver
  getChatConfigurationForModelEntry?: (modelEntryId: string) => ChatProviderConfiguration | null
  getSelectedModelEntryId?: () => string | null
  getSelectedChatConfiguration?: () => ChatProviderConfiguration | null
  runtime?: Pick<SessionRuntimeService, 'getDefaultProfile' | 'updateDefaultProfile'>
}

type SessionModelSelection = {
  provider: ChatProvider | null
  configuration: ChatProviderConfiguration | null
  modelEntryId: string | null
}

/**
 * Owns which provider and model a session runs on. Every question of "which
 * configuration backs this session, this model entry, or the global selection"
 * resolves here, and the resulting execution profile is hashed and persisted
 * here, so neither the turn executor nor IPC handlers need the provider
 * library's lookup rules.
 */
class SessionModelProfile {
  readonly #resolveProvider: ChatProviderResolver
  readonly #getChatConfigurationForModelEntry: SessionModelProfileDependencies['getChatConfigurationForModelEntry']
  readonly #getSelectedModelEntryId: SessionModelProfileDependencies['getSelectedModelEntryId']
  readonly #getSelectedChatConfiguration: SessionModelProfileDependencies['getSelectedChatConfiguration']
  readonly #runtime: SessionModelProfileDependencies['runtime']

  constructor(dependencies: SessionModelProfileDependencies) {
    this.#resolveProvider = dependencies.resolveProvider
    this.#getChatConfigurationForModelEntry = dependencies.getChatConfigurationForModelEntry
    this.#getSelectedModelEntryId = dependencies.getSelectedModelEntryId
    this.#getSelectedChatConfiguration = dependencies.getSelectedChatConfiguration
    this.#runtime = dependencies.runtime
  }

  /**
   * Resolves the provider backing one turn of a session. Without a session
   * runtime, only the injected resolver answers — the same fallback the
   * executor used before session profiles existed.
   */
  resolveForSession(sessionId: string): SessionModelSelection {
    if (!this.#runtime)
      return { provider: this.#resolveProvider(), configuration: null, modelEntryId: null }

    const defaultProfile = this.#runtime.getDefaultProfile(sessionId)
    const configuration = defaultProfile
      ? (this.#getChatConfigurationForModelEntry?.(defaultProfile.modelEntryId) ?? null)
      : (this.#getSelectedChatConfiguration?.() ?? null)
    if (!configuration) throw new NoModelSelectedError()
    const modelEntryId =
      defaultProfile?.modelEntryId ?? this.#getSelectedModelEntryId?.() ?? configuration.modelId
    const provider = this.#resolveProvider(modelEntryId)
    if (!provider) throw new NoModelSelectedError()
    return { provider, configuration, modelEntryId }
  }

  resolveForProfile(profile: ExecutionProfileSnapshot): SessionModelSelection {
    const configuration = this.#getChatConfigurationForModelEntry?.(profile.modelEntryId)
    if (!configuration)
      throw new NoModelSelectedError(
        'The original model is unavailable. Restore its provider settings before retrying this turn.'
      )
    const current = this.toProfile(configuration, profile.modelEntryId, profile.thinkingEffort)
    if (
      current.providerId !== profile.providerId ||
      current.modelId !== profile.modelId ||
      current.configurationDigest !== profile.configurationDigest
    )
      throw new NoModelSelectedError(
        'The original provider configuration changed. Restore its endpoint and model settings before retrying this turn.'
      )
    const provider = this.#resolveProvider(profile.modelEntryId)
    if (!provider)
      throw new NoModelSelectedError(
        'The original model is unavailable. Restore its provider settings before retrying this turn.'
      )
    return { provider, configuration, modelEntryId: profile.modelEntryId }
  }

  getCapabilities(sessionId?: string): Promise<ModelReasoningCapabilities | null> {
    const modelEntryId =
      (sessionId ? this.#runtime?.getDefaultProfile(sessionId)?.modelEntryId : undefined) ??
      this.#getSelectedModelEntryId?.()
    return (
      this.#resolveProvider(modelEntryId ?? undefined)?.getModelCapabilities() ??
      Promise.resolve(null)
    )
  }

  toProfile(
    configuration: ChatProviderConfiguration,
    modelEntryId: string,
    thinkingEffort: ExecutionProfileSnapshot['thinkingEffort']
  ): ExecutionProfileSnapshot {
    const safeConfiguration = { ...configuration }
    if ('apiKey' in safeConfiguration) delete safeConfiguration.apiKey
    return {
      modelEntryId,
      providerId: configuration.provider,
      modelId: configuration.modelId,
      thinkingEffort,
      configurationDigest: createHash('sha256')
        .update(JSON.stringify(safeConfiguration))
        .digest('hex')
    }
  }

  persistSessionProfile(sessionId: string, profile: ExecutionProfileSnapshot): void {
    this.#runtime?.updateDefaultProfile(sessionId, profile)
  }

  updateSessionThinkingEffort(
    sessionId: string,
    thinkingEffort: ExecutionProfileSnapshot['thinkingEffort']
  ): void {
    const profile = this.#runtime?.getDefaultProfile(sessionId) ?? null
    const configuration = profile?.modelEntryId
      ? this.#getChatConfigurationForModelEntry?.(profile.modelEntryId)
      : this.#getSelectedChatConfiguration?.()
    if (!configuration || !this.#runtime) throw new NoModelSelectedError()
    if (!profile?.modelEntryId)
      throw new NoModelSelectedError('Select an enabled model for this session before chatting.')
    this.#runtime.updateDefaultProfile(
      sessionId,
      this.toProfile(configuration, profile.modelEntryId, thinkingEffort)
    )
  }

  updateSessionModelEntry(sessionId: string, modelEntryId: string): void {
    const configuration = this.#getChatConfigurationForModelEntry?.(modelEntryId)
    if (!configuration || !this.#runtime) throw new NoModelSelectedError()
    const thinkingEffort = this.#runtime.getDefaultProfile(sessionId)?.thinkingEffort ?? 'default'
    this.#runtime.updateDefaultProfile(
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
