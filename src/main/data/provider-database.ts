import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import { providerLibraryState, providers } from './provider-schema'
import { providerMigrations } from './provider-migrations'
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
    try {
      sqlite.pragma('journal_mode = WAL')
      sqlite.pragma('synchronous = NORMAL')
      sqlite.pragma('foreign_keys = ON')
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS provider_schema_migrations (
          id TEXT PRIMARY KEY NOT NULL,
          applied_at INTEGER NOT NULL
        );
      `)
      const appliedMigrationIds = new Set(
        sqlite
          .prepare('SELECT id FROM provider_schema_migrations ORDER BY id')
          .pluck()
          .all()
          .map(String)
      )
      const knownMigrationIds = new Set<string>(providerMigrations.map((migration) => migration.id))
      const unknownMigrationId = [...appliedMigrationIds].find((id) => !knownMigrationIds.has(id))
      if (unknownMigrationId)
        throw new Error(`Provider database contains unknown migration ${unknownMigrationId}.`)

      const recordMigration = sqlite.prepare(
        'INSERT INTO provider_schema_migrations (id, applied_at) VALUES (?, ?)'
      )
      for (const migration of providerMigrations) {
        if (appliedMigrationIds.has(migration.id)) continue
        sqlite.transaction(() => {
          migration.apply(sqlite)
          recordMigration.run(migration.id, Date.now())
        })()
      }
    } catch (error) {
      sqlite.close()
      throw error
    }

    this.sqlite = sqlite
    this.database = drizzle(sqlite, { schema })
    this.db
      .insert(providers)
      .values([
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
