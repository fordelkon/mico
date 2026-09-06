import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import { providerLibraryState, providers } from './provider-schema'
import * as schema from './provider-schema'

type ProviderDatabaseDependencies = {
  getUserDataPath?: () => string
  openDatabase?: (path: string) => Database.Database
}

const defaultDependencies: Required<ProviderDatabaseDependencies> = {
  getUserDataPath: () => app.getPath('userData'),
  openDatabase: (path) => new Database(path)
}

class ProviderDatabase {
  private readonly dependencies: Required<ProviderDatabaseDependencies>
  private database: BetterSQLite3Database<typeof schema> | undefined
  private sqlite: Database.Database | undefined

  constructor(dependencies: ProviderDatabaseDependencies = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies }
  }

  get db(): BetterSQLite3Database<typeof schema> {
    if (!this.database) throw new Error('Provider database is not initialized.')
    return this.database
  }

  get connection(): Database.Database {
    if (!this.sqlite) throw new Error('Provider database is not initialized.')
    return this.sqlite
  }

  async initialize(): Promise<void> {
    const userDataPath = this.dependencies.getUserDataPath()
    await mkdir(userDataPath, { recursive: true })

    const sqlite = this.dependencies.openDatabase(join(userDataPath, 'providers.db'))
    sqlite.pragma('foreign_keys = ON')
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL,
        api_format TEXT,
        api_key TEXT,
        base_url TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        headers TEXT NOT NULL DEFAULT '{}',
        icon TEXT,
        max_tokens INTEGER,
        name TEXT,
        use_max_completion_tokens INTEGER
      );
      CREATE TABLE IF NOT EXISTS provider_models (
        id TEXT PRIMARY KEY NOT NULL,
        provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        discovery_order INTEGER NOT NULL DEFAULT 0,
        enabled_order INTEGER,
        CONSTRAINT provider_models_provider_model UNIQUE(provider_id, model_id)
      );
      CREATE TABLE IF NOT EXISTS provider_library_state (
        id INTEGER PRIMARY KEY NOT NULL,
        selected_model_id TEXT,
        selected_provider_id TEXT
      );
    `)
    // SAFETY: SQLite's table_info pragma always returns a `name` column for each table column.
    const modelColumns = sqlite.prepare('PRAGMA table_info(provider_models)').all() as Array<{
      name: string
    }>
    if (!modelColumns.some(({ name }) => name === 'enabled'))
      sqlite.exec('ALTER TABLE provider_models ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1')
    if (!modelColumns.some(({ name }) => name === 'discovery_order'))
      sqlite.exec(
        'ALTER TABLE provider_models ADD COLUMN discovery_order INTEGER NOT NULL DEFAULT 0'
      )
    if (!modelColumns.some(({ name }) => name === 'enabled_order'))
      sqlite.exec('ALTER TABLE provider_models ADD COLUMN enabled_order INTEGER')
    // SAFETY: SQLite's table_info pragma always returns a `name` column for each table column.
    const libraryStateColumns = sqlite
      .prepare('PRAGMA table_info(provider_library_state)')
      .all() as Array<{
      name: string
    }>
    if (!libraryStateColumns.some(({ name }) => name === 'selected_provider_id'))
      sqlite.exec('ALTER TABLE provider_library_state ADD COLUMN selected_provider_id TEXT')

    this.sqlite = sqlite
    this.database = drizzle(sqlite, { schema })
    this.db
      .insert(providers)
      .values([
        {
          id: 'lm-studio',
          kind: 'builtin',
          baseUrl: 'http://localhost:1234',
          enabled: false
        },
        { id: 'ollama', kind: 'builtin', baseUrl: 'http://localhost:11434', enabled: false }
      ])
      .onConflictDoNothing()
      .run()
    this.db
      .insert(providerLibraryState)
      .values({ id: 1, selectedModelId: null, selectedProviderId: null })
      .onConflictDoNothing()
      .run()

    await rm(join(userDataPath, 'providers.json'), { force: true })
  }
}

export { ProviderDatabase }
export type { ProviderDatabaseDependencies }
