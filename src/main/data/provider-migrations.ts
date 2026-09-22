type ProviderMigration = {
  id:
    | '0001_initial_provider_library'
    | '0002_add_provider_library_columns'
    | '0003_remove_lm_studio_builtin_provider'
    | '0004_remove_use_max_completion_tokens'
  sql: string
}

const providerMigrations: readonly ProviderMigration[] = [
  {
    id: '0001_initial_provider_library',
    sql: `
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
    `
  },
  {
    id: '0002_add_provider_library_columns',
    // The conditional column additions this migration once performed were no-ops from
    // its first revision: every column it guarded already exists in 0001. The backfill
    // below is the migration's only observable effect, for every recorded database.
    sql: `
      UPDATE providers SET enabled_order = rowid WHERE enabled = 1 AND enabled_order IS NULL;
    `
  },
  {
    id: '0003_remove_lm_studio_builtin_provider',
    sql: `
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
    `
  },
  {
    id: '0004_remove_use_max_completion_tokens',
    // The flag never reached a provider request: no adapter sends a token limit,
    // so the column and its settings toggle were removed outright.
    sql: `
      ALTER TABLE providers DROP COLUMN use_max_completion_tokens;
    `
  }
]

export { providerMigrations }
export type { ProviderMigration }
