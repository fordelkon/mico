import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'
import oxlint from 'eslint-plugin-oxlint'

export default defineConfig(
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out',
      '**/storybook-static',
      'playwright-report/**',
      'test-results/**',
      'tools/oxlint/anti-slop/**'
    ]
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    // Playwright fixtures call a `use(...)` teardown callback that is not a React hook,
    // and their first parameter is conventionally an empty destructuring pattern.
    files: ['tests/e2e/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'react-refresh/only-export-components': 'off',
      'no-empty-pattern': 'off'
    }
  },
  // Formatting is Biome's job now (see biome.jsonc), and anything oxlint
  // already covers is turned off here so the two don't do redundant work.
  // Must stay last: https://github.com/oxc-project/eslint-plugin-oxlint
  ...oxlint.configs['flat/eslint'],
  ...oxlint.configs['flat/typescript'],
  ...oxlint.configs['flat/react']
)
