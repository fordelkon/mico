import type Database from 'better-sqlite3'

type ProviderMigration = {
  id:
    | '0001_initial_provider_library'
    | '0002_add_provider_library_columns'
    | '0003_remove_lm_studio_builtin_provider'
  apply: (connection: Database.Database) => void
}

function hasColumn(connection: Database.Database, table: string, column: string): boolean {
  // SAFETY: SQLite's table_info pragma returns a name field for every table column.
  const columns = connection.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return columns.some(({ name }) => name === column)
}

function addColumnIfMissing(
  connection: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  if (!hasColumn(connection, table, column))
    connection.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
}

const providerMigrations: readonly ProviderMigration[] = [
  {
    id: '0001_initial_provider_library',
    apply: (connection) => {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS providers (
          id TEXT PRIMARY KEY NOT NULL,
          kind TEXT NOT NULL,
          api_format TEXT,
          api_key TEXT,
          base_url TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 0,
          enabled_order INTEGER,
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
    }
  },
  {
    id: '0002_add_provider_library_columns',
    apply: (connection) => {
      addColumnIfMissing(
        connection,
        'provider_models',
        'enabled',
        'enabled INTEGER NOT NULL DEFAULT 1'
      )
      addColumnIfMissing(
        connection,
        'provider_models',
        'discovery_order',
        'discovery_order INTEGER NOT NULL DEFAULT 0'
      )
      addColumnIfMissing(connection, 'provider_models', 'enabled_order', 'enabled_order INTEGER')
      addColumnIfMissing(connection, 'providers', 'enabled_order', 'enabled_order INTEGER')
      addColumnIfMissing(
        connection,
        'provider_library_state',
        'selected_provider_id',
        'selected_provider_id TEXT'
      )
      connection.exec(
        'UPDATE providers SET enabled_order = rowid WHERE enabled = 1 AND enabled_order IS NULL'
      )
    }
  },
  {
    id: '0003_remove_lm_studio_builtin_provider',
    apply: (connection) => {
      connection.exec(`
        UPDATE provider_library_state
        SET
          selected_model_id = NULL,
          selected_provider_id = CASE
            WHEN selected_provider_id = 'lm-studio' THEN NULL
            ELSE selected_provider_id
          END
        WHERE selected_provider_id = 'lm-studio'
          OR selected_model_id IN (
            SELECT id FROM provider_models WHERE provider_id = 'lm-studio'
          );
        DELETE FROM providers WHERE id = 'lm-studio';
      `)
    }
  }
]

export { providerMigrations }
export type { ProviderMigration }
