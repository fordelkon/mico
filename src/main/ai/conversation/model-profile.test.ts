import { CodingAgent } from '@mico/coding-agent'
import { PermissionRequests } from './tool-approvals'
import { afterEach, describe, expect, it } from 'vitest'
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
  const agent = new CodingAgent({
    models,
    runtime,
    requestApproval: new PermissionRequests().request
  })
  return { models, runtime, session, agent }
}

describe('SessionModelProfile', () => {
  afterEach(removeTemporaryPaths)

  it('user changes the session model when effort was saved, then the new profile preserves effort', async () => {
    const { runtime, session, agent } = await setup()
    agent.setSessionModelEntry(session.id, 'original-entry')
    agent.setSessionThinkingEffort(session.id, 'high')
    agent.setSessionModelEntry(session.id, 'other-entry')
    expect(runtime.loadSession(session.id).defaultProfile).toMatchObject({
      modelEntryId: 'other-entry',
      modelId: 'other',
      thinkingEffort: 'high'
    })
  })

  it('user selects a disabled model when a session profile exists, then the saved profile is retained', async () => {
    const { models, runtime, session, agent } = await setup()
    agent.setSessionModelEntry(session.id, 'original-entry')
    const original = runtime.getDefaultProfile(session.id)
    await models.saveLibrary({
      ...models.getLibrary(),
      models: models
        .getLibrary()
        .models.map((model) => (model.id === 'other-entry' ? { ...model, enabled: false } : model))
    })
    expect(() => agent.setSessionModelEntry(session.id, 'other-entry')).toThrow('enabled model')
    expect(runtime.getDefaultProfile(session.id)).toEqual(original)
  })

  it('user changes effort before choosing a session model when no profile exists, then selection guidance is shown', async () => {
    const { runtime, session, agent } = await setup()
    expect(() => agent.setSessionThinkingEffort(session.id, 'high')).toThrow(
      'Select an enabled model for this session'
    )
    expect(runtime.getDefaultProfile(session.id)).toBeNull()
  })
})
