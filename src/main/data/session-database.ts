import { join } from 'node:path'

import Database from 'better-sqlite3'
import { app } from 'electron'

import { sessionMigrations } from './session-migrations'
import { SqliteDatabase } from './sqlite-database'

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
  private sqlite: SqliteDatabase | undefined

  constructor(dependencies: SessionDatabaseDependencies = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies }
  }

  get connection(): Database.Database {
    if (!this.sqlite) throw new Error('Session database is not initialized.')
    return this.sqlite.connection
  }

  async initialize(): Promise<void> {
    if (this.sqlite) return

    const userDataPath = this.dependencies.getUserDataPath()
    // ':memory:' selects a private in-memory database; no directory or file is created.
    this.sqlite = await SqliteDatabase.open({
      path: userDataPath === ':memory:' ? ':memory:' : join(userDataPath, 'sessions.db'),
      migrations: sessionMigrations,
      migrationTable: 'session_schema_migrations',
      label: 'Session',
      extraPragmas: ['busy_timeout = 5000'],
      open: this.dependencies.openDatabase
    })
  }

  transaction<T>(operation: () => T): T {
    if (!this.sqlite) throw new Error('Session database is not initialized.')
    return this.sqlite.transaction(operation)
  }

  close(): void {
    this.sqlite?.close()
    this.sqlite = undefined
  }
}

export { SessionDatabase }
export type { SessionDatabaseDependencies }
