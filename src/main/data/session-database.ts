import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { app } from 'electron'

import { sessionMigrations } from './session-migrations'
import * as sessionSchema from './session-schema'

type SessionDatabaseDependencies = {
  getUserDataPath?: () => string
  openDatabase?: (path: string) => Database.Database
}

const defaultDependencies: Required<SessionDatabaseDependencies> = {
  getUserDataPath: () => app.getPath('userData'),
  openDatabase: (path) => new Database(path)
}

class SessionDatabase {
  private readonly dependencies: Required<SessionDatabaseDependencies>
  private database: BetterSQLite3Database<typeof sessionSchema> | undefined
  private sqlite: Database.Database | undefined

  constructor(dependencies: SessionDatabaseDependencies = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies }
  }

  get db(): BetterSQLite3Database<typeof sessionSchema> {
    if (!this.database) throw new Error('Session database is not initialized.')
    return this.database
  }

  get connection(): Database.Database {
    if (!this.sqlite) throw new Error('Session database is not initialized.')
    return this.sqlite
  }

  async initialize(): Promise<void> {
    if (this.sqlite) return

    const userDataPath = this.dependencies.getUserDataPath()
    await mkdir(userDataPath, { recursive: true })

    const sqlite = this.dependencies.openDatabase(join(userDataPath, 'sessions.db'))
    try {
      // WAL + synchronous=NORMAL: commits skip the full fsync on every transaction.
      // Durability is preserved against app crashes; an OS crash or power loss can roll
      // back the last transactions, which is the accepted trade-off for chat logs.
      sqlite.pragma('journal_mode = WAL')
      sqlite.pragma('synchronous = NORMAL')
      sqlite.pragma('foreign_keys = ON')
      sqlite.pragma('busy_timeout = 5000')
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS session_schema_migrations (
          id TEXT PRIMARY KEY NOT NULL,
          applied_at INTEGER NOT NULL
        );
      `)

      const appliedMigrationIds = new Set(
        sqlite
          .prepare('SELECT id FROM session_schema_migrations ORDER BY id')
          .pluck()
          .all()
          .map(String)
      )
      const knownMigrationIds = new Set<string>(sessionMigrations.map((migration) => migration.id))
      const unknownMigrationId = [...appliedMigrationIds].find((id) => !knownMigrationIds.has(id))
      if (unknownMigrationId)
        throw new Error(`Session database contains unknown migration ${unknownMigrationId}.`)

      const recordMigration = sqlite.prepare(
        'INSERT INTO session_schema_migrations (id, applied_at) VALUES (?, ?)'
      )
      for (const migration of sessionMigrations) {
        if (appliedMigrationIds.has(migration.id)) continue
        sqlite.transaction(() => {
          sqlite.exec(migration.sql)
          recordMigration.run(migration.id, Date.now())
        })()
      }

      this.sqlite = sqlite
      this.database = drizzle(sqlite, { schema: sessionSchema })
    } catch (error) {
      sqlite.close()
      throw error
    }
  }

  transaction<T>(operation: () => T): T {
    return this.connection.transaction(operation).immediate()
  }

  close(): void {
    this.sqlite?.close()
    this.sqlite = undefined
    this.database = undefined
  }
}

export { SessionDatabase }
export type { SessionDatabaseDependencies }
