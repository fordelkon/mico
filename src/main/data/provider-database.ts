import { join } from 'node:path'

import Database from 'better-sqlite3'
import { app } from 'electron'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { rm } from 'node:fs/promises'

import { providerLibraryState, providers } from './provider-schema'
import { providerMigrations } from './provider-migrations'
import * as schema from './provider-schema'
import { SqliteDatabase } from './sqlite-database'

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
  private sqlite: SqliteDatabase | undefined

  constructor(dependencies: ProviderDatabaseDependencies = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies }
  }

  get db(): BetterSQLite3Database<typeof schema> {
    if (!this.database) throw new Error('Provider database is not initialized.')
    return this.database
  }

  get connection(): Database.Database {
    if (!this.sqlite) throw new Error('Provider database is not initialized.')
    return this.sqlite.connection
  }

  async initialize(): Promise<void> {
    const userDataPath = this.dependencies.getUserDataPath()
    const sqlite = await SqliteDatabase.open({
      path: join(userDataPath, 'providers.db'),
      migrations: providerMigrations,
      migrationTable: 'provider_schema_migrations',
      label: 'Provider',
      open: this.dependencies.openDatabase
    })
    this.sqlite = sqlite
    this.database = drizzle(sqlite.connection, { schema })
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
