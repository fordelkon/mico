import { afterEach, describe, expect, it } from 'vitest'
import { SessionModelProfile } from './model-profile'
import { createModels, createRuntime, removeTemporaryPaths } from './test-helpers'

const configuration = {
  provider: 'ollama' as const,
  baseUrl: 'http://localhost:11434',
  modelId: 'original'
}

async function setup() {
  const models = await createModels(
    () => ({
      getModelCapabilities: async () => null,
      stream: async () => ({ async *[Symbol.asyncIterator]() {} })
    }),
    configuration,
    'original-entry'
  )
  await models.saveLibrary({
    ...models.getLibrary(),
    models: [
      ...models.getLibrary().models,
      {
        id: 'other-entry',
        provider: 'ollama',
        modelId: 'other',
        displayName: 'Other',
        enabled: true
      }
    ]
  })
  const { runtime } = await createRuntime()
  const session = runtime.createSession({ title: 'Session', defaultProfile: null })
  return { models, runtime, session, profiles: new SessionModelProfile({ models, runtime }) }
}

describe('SessionModelProfile', () => {
  afterEach(removeTemporaryPaths)

  it('user changes the session model when effort was saved, then the new profile preserves effort', async () => {
    const { runtime, session, profiles } = await setup()
    profiles.updateSessionModelEntry(session.id, 'original-entry')
    profiles.updateSessionThinkingEffort(session.id, 'high')
    profiles.updateSessionModelEntry(session.id, 'other-entry')
    expect(runtime.loadSession(session.id).defaultProfile).toMatchObject({
      modelEntryId: 'other-entry',
      modelId: 'other',
      thinkingEffort: 'high'
    })
  })

  it('user selects a disabled model when a session profile exists, then the saved profile is retained', async () => {
    const { models, runtime, session, profiles } = await setup()
    profiles.updateSessionModelEntry(session.id, 'original-entry')
    const original = runtime.getDefaultProfile(session.id)
    await models.saveLibrary({
      ...models.getLibrary(),
      models: models
        .getLibrary()
        .models.map((model) => (model.id === 'other-entry' ? { ...model, enabled: false } : model))
    })
    expect(() => profiles.updateSessionModelEntry(session.id, 'other-entry')).toThrow(
      'enabled model'
    )
    expect(runtime.getDefaultProfile(session.id)).toEqual(original)
  })

  it('user changes effort before choosing a session model when no profile exists, then selection guidance is shown', async () => {
    const { runtime, session, profiles } = await setup()
    expect(() => profiles.updateSessionThinkingEffort(session.id, 'high')).toThrow(
      'Select an enabled model for this session'
    )
    expect(runtime.getDefaultProfile(session.id)).toBeNull()
  })
})
