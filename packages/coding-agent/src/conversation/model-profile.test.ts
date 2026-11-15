import type { ChatProviderConfiguration } from '@mico/ai-providers'
import { describe, expect, it, vi } from 'vitest'
import type { ExecutionProfileSnapshot } from '../contracts'
import { SessionModelProfile, type SessionModels } from './model-profile'
import type { SessionStore } from './session-store'

const sessionId = 'session'
const originalProfile: ExecutionProfileSnapshot = {
  modelEntryId: 'original-entry',
  providerId: 'ollama',
  modelId: 'original',
  thinkingEffort: 'high',
  configurationDigest: 'original-configuration'
}
const otherConfiguration: ChatProviderConfiguration = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  modelId: 'other'
}

function setup(initialProfile: ExecutionProfileSnapshot | null = originalProfile) {
  let storedProfile = initialProfile
  const runtime = {
    getDefaultProfile: vi.fn<SessionStore['getDefaultProfile']>(() => storedProfile),
    updateDefaultProfile: vi.fn<SessionStore['updateDefaultProfile']>((_sessionId, profile) => {
      storedProfile = profile
    }),
    updateDefaultProfileIfCurrent: vi.fn<SessionStore['updateDefaultProfileIfCurrent']>()
  } satisfies Pick<
    SessionStore,
    'getDefaultProfile' | 'updateDefaultProfile' | 'updateDefaultProfileIfCurrent'
  >
  const models = {
    resolveForSession: vi.fn<SessionModels['resolveForSession']>(),
    resolveForProfile: vi.fn<SessionModels['resolveForProfile']>(),
    getCapabilities: vi.fn<SessionModels['getCapabilities']>(),
    getChatConfigurationForModelEntry: vi
      .fn<SessionModels['getChatConfigurationForModelEntry']>()
      .mockReturnValue(otherConfiguration),
    // The host encodes identity and the supplied effort; session policy stays in production.
    toProfile: vi.fn<SessionModels['toProfile']>((configuration, modelEntryId, thinkingEffort) => ({
      modelEntryId,
      providerId: 'ollama',
      modelId: configuration.modelId,
      thinkingEffort,
      configurationDigest: 'other-configuration'
    }))
  } satisfies SessionModels
  const profile = new SessionModelProfile({ models, runtime })
  return { models, runtime, profile }
}

describe('SessionModelProfile', () => {
  it('user switches models when effort is saved, then the new profile preserves effort', () => {
    const { runtime, profile } = setup()

    profile.updateSessionModelEntry(sessionId, 'other-entry')

    expect(runtime.getDefaultProfile(sessionId)).toEqual({
      modelEntryId: 'other-entry',
      providerId: 'ollama',
      modelId: 'other',
      thinkingEffort: 'high',
      configurationDigest: 'other-configuration'
    })
  })

  it('user selects a disabled model when a profile exists, then selection fails and the profile stays', () => {
    const { models, runtime, profile } = setup()
    models.getChatConfigurationForModelEntry.mockReturnValue(null)

    expect(() => profile.updateSessionModelEntry(sessionId, 'other-entry')).toThrow('enabled model')

    expect(runtime.updateDefaultProfile).not.toHaveBeenCalled()
    expect(runtime.getDefaultProfile(sessionId)).toEqual(originalProfile)
  })

  it('user changes effort when no model is selected, then selection guidance is shown', () => {
    const { runtime, profile } = setup(null)

    expect(() => profile.updateSessionThinkingEffort(sessionId, 'high')).toThrow(
      'Select an enabled model for this session'
    )

    expect(runtime.updateDefaultProfile).not.toHaveBeenCalled()
    expect(runtime.getDefaultProfile(sessionId)).toBeNull()
  })
})
