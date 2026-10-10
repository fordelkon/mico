import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url))
    }
  },
  test: {
    // Coverage must stay scoped to the sources these projects execute. Without
    // an explicit include, the default pulls every TS file in the repo —
    // including packages/* that only their own vitest projects test — and
    // reports them as 0% in the root report.
    coverage: {
      include: ['src/main/**/*.{ts,tsx}', 'src/renderer/**/*.{ts,tsx}', 'src/shared/**/*.ts'],
      reporter: ['text', 'html', 'json-summary'],
      reportOnFailure: true,
      thresholds: { statements: 80, branches: 77, functions: 80, lines: 85 }
    },
    projects: [
      {
        extends: true,
        test: {
          environment: 'jsdom',
          include: ['src/renderer/src/**/*.{test,spec}.{ts,tsx}', 'src/shared/**/*.{test,spec}.ts'],
          name: 'renderer',
          setupFiles: ['./src/renderer/test/setup.ts']
        }
      },
      {
        extends: true,
        test: {
          environment: 'node',
          include: ['src/main/**/*.{test,spec}.ts', 'scripts/lint/*.test.mjs'],
          name: 'main'
        }
      }
    ]
  }
})
