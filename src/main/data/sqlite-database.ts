import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import Database from 'better-sqlite3'

type SqliteMigration = { id: string; sql: string }
type SqliteDatabaseOptions = {
  /** Filesystem path, or the ':memory:' sentinel for a private in-memory database. */
  path: string
  migrations: readonly SqliteMigration[]
  /** Name of the table recording applied migration ids; preserved per store for compatibility. */
  migrationTable: string
  /** Store name used in the unknown-migration startup error. */
  label: string
  extraPragmas?: readonly string[]
  open?: (path: string) => Database.Database
}

/**
 * Shared better-sqlite3 setup: pragmas, idempotent string-SQL migrations, and
 * transactions. Opening is on guard against databases written by a newer or
 * older schema than this build knows: an applied migration id that is not part
 * of the current migration list fails startup instead of silently diverging.
 */
class SqliteDatabase {
  private readonly sqlite: Database.Database

  private constructor(sqlite: Database.Database) {
    this.sqlite = sqlite
  }

  static async open(options: SqliteDatabaseOptions): Promise<SqliteDatabase> {
    const { path, migrations, migrationTable, label, extraPragmas = [], open } = options
    if (path !== ':memory:') await mkdir(dirname(path), { recursive: true })
    const sqlite = (open ?? ((p: string) => new Database(p)))(path)
    try {
      // WAL + synchronous=NORMAL: commits skip the full fsync on every transaction.
      // Durability is preserved against app crashes; an OS crash or power loss can roll
      // back the last transactions, which is the accepted trade-off for chat logs.
      sqlite.pragma('journal_mode = WAL')
      sqlite.pragma('synchronous = NORMAL')
      sqlite.pragma('foreign_keys = ON')
      for (const pragma of extraPragmas) sqlite.pragma(pragma)
      // This table records the schema changes already applied to the store.
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS ${migrationTable} (
          id TEXT PRIMARY KEY NOT NULL,
          applied_at INTEGER NOT NULL
        );
      `)

      const appliedMigrationIds = new Set(
        sqlite.prepare(`SELECT id FROM ${migrationTable} ORDER BY id`).pluck().all().map(String)
      )
      const knownMigrationIds = new Set<string>(migrations.map((migration) => migration.id))
      const unknownMigrationId = [...appliedMigrationIds].find((id) => !knownMigrationIds.has(id))
      if (unknownMigrationId)
        throw new Error(`${label} database contains unknown migration ${unknownMigrationId}.`)

      const recordMigration = sqlite.prepare(
        `INSERT INTO ${migrationTable} (id, applied_at) VALUES (?, ?)`
      )
      for (const migration of migrations) {
        if (appliedMigrationIds.has(migration.id)) continue
        sqlite.transaction(() => {
          sqlite.exec(migration.sql)
          recordMigration.run(migration.id, Date.now())
        })()
      }
      return new SqliteDatabase(sqlite)
    } catch (error) {
      sqlite.close()
      throw error
    }
  }

  get connection(): Database.Database {
    return this.sqlite
  }

  transaction<T>(operation: () => T): T {
    return this.sqlite.transaction(operation).immediate()
  }

  close(): void {
    this.sqlite.close()
  }
}

export { SqliteDatabase }
export type { SqliteMigration }
