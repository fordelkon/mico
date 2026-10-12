import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatProvider, ChatProviderConfiguration } from '@mico/ai-providers'
import Database from 'better-sqlite3'
import { ProviderDatabase } from '@main/data/provider-database'
import { SessionDatabase } from '@main/data/session-database'
import { Models } from '../models'
import { SessionRuntimeService } from './runtime'

const temporaryPaths: string[] = []
const connections: Database.Database[] = []

async function createTemporaryWorkspace(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  temporaryPaths.push(path)
  return path
}

async function removeTemporaryPaths(): Promise<void> {
  for (const connection of connections.splice(0)) {
    if (connection.open) connection.close()
  }
  await Promise.all(
    temporaryPaths.splice(0).map((path) =>
      rm(path, {
        force: true,
        recursive: true,
        maxRetries: process.platform === 'win32' ? 10 : 0,
        retryDelay: 100
      })
    )
  )
}

const defaultConfiguration: ChatProviderConfiguration = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  modelId: 'qwen3:8b'
}

/** Real model selection and persistence with only the external provider stream replaced. */
async function createModels(
  createChatProvider: (configuration: ChatProviderConfiguration) => ChatProvider,
  configuration: ChatProviderConfiguration = defaultConfiguration,
  modelEntryId = 'ollama:qwen3'
): Promise<Models> {
  const directory = await createTemporaryWorkspace('mico-conversation-models-')
  const database = new ProviderDatabase({
    getUserDataPath: () => directory,
    openDatabase: () => new Database(':memory:')
  })
  const models = new Models({ database, createChatProvider })
  await models.initialize()
  connections.push(database.connection)
  const { modelId, ...providerConfiguration } = configuration
  await models.saveLibrary({
    configurations: [{ ...providerConfiguration, enabled: true }],
    customProviders: [],
    enabledProviderIds: [configuration.provider],
    models: [
      {
        id: modelEntryId,
        provider: configuration.provider,
        modelId,
        displayName: modelId,
        enabled: true
      }
    ],
    selectedModelId: modelEntryId,
    selectedProviderId: configuration.provider
  })
  return models
}

async function createRuntime(sessionIds: readonly string[] = []): Promise<{
  database: SessionDatabase
  runtime: SessionRuntimeService
}> {
  const database = new SessionDatabase({ getUserDataPath: () => ':memory:' })
  await database.initialize()
  connections.push(database.connection)
  const pendingIds = [...sessionIds]
  const runtime = new SessionRuntimeService({
    database,
    createId: () => pendingIds.shift() ?? randomUUID()
  })
  return { database, runtime }
}

/** A provider request is a title request when it uses the documented one-line title contract. */
function isTitleStream(input: Parameters<ChatProvider['stream']>[0]): boolean {
  const firstPart = input.messages[0]?.parts[0]
  return (
    input.messages[0]?.role === 'system' &&
    firstPart?.type === 'text' &&
    firstPart.text.includes('Output exactly one title on one line only.')
  )
}

export {
  createModels,
  createRuntime,
  createTemporaryWorkspace,
  removeTemporaryPaths,
  isTitleStream
}
