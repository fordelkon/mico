import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'coding-agent',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      reporter: ['text', 'html', 'json-summary'],
      reportOnFailure: true,
      thresholds: { statements: 60, branches: 55, functions: 60, lines: 62 }
    }
  }
})
