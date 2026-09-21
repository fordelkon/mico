import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { SqliteDatabase } from './sqlite-database'

const probeMigrations = [
  { id: '0001_probe', sql: 'CREATE TABLE log (id TEXT NOT NULL);' },
  { id: '0002_probe', sql: "INSERT INTO log (id) VALUES ('0002');" }
]

function openStore(path: string, migrations = probeMigrations): Promise<SqliteDatabase> {
  return SqliteDatabase.open({
    path,
    migrations,
    migrationTable: 'store_schema_migrations',
    label: 'Store'
  })
}

describe('SqliteDatabase', () => {
  it('user opens a store database when migrations are pending, then each is applied exactly once in order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sqlite-'))
    const path = join(root, 'store.db')

    const first = await openStore(path)
    first.close()
    const reopened = await openStore(path)

    // SAFETY: the migration table stores exactly the id column selected above.
    const appliedRows = reopened.connection
      .prepare('SELECT id FROM store_schema_migrations ORDER BY id')
      .all() as Array<{ id: string }>
    expect(appliedRows.map((row) => row.id)).toEqual(['0001_probe', '0002_probe'])
    expect(reopened.connection.prepare('SELECT count(*) AS count FROM log').get()).toEqual({
      count: 1
    })
  })

  it('user opens a store database when it contains an unknown applied migration, then startup fails naming it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sqlite-'))
    const path = join(root, 'store.db')
    const current = await openStore(path)
    current.close()
    // A newer build recorded a migration this build does not know about.
    const newer = new Database(path)
    newer
      .prepare("INSERT INTO store_schema_migrations (id, applied_at) VALUES ('9999_future', 1)")
      .run()
    newer.close()

    await expect(openStore(path)).rejects.toThrow(
      'Store database contains unknown migration 9999_future.'
    )
  })
})
