import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      reporter: ['text', 'html', 'json-summary'],
      reportOnFailure: true,
      thresholds: { statements: 90, branches: 80, functions: 90, lines: 90 }
    }
  }
})
