import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SessionDatabase } from './session-database'

describe('SessionDatabase', () => {
  it('user opens the session database when the path is the in-memory sentinel, then no files are created on disk', async () => {
    const database = new SessionDatabase({ getUserDataPath: () => ':memory:' })

    await database.initialize()

    database.connection
      .prepare(
        'INSERT INTO sessions (id, title, created_at, updated_at, last_activity_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run('session-1', 'Session', 1, 1, 1)
    // The sentinel must never leak to the filesystem as a directory or database file.
    expect(existsSync(':memory:')).toBe(false)
    expect(existsSync(join(':memory:', 'sessions.db'))).toBe(false)
  })
})
