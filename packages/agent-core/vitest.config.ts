import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'agent-core',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      reporter: ['text', 'html', 'json-summary'],
      reportOnFailure: true,
      thresholds: { statements: 73, branches: 66, functions: 70, lines: 74 }
    }
  }
})
