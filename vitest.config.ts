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
          include: ['src/main/**/*.{test,spec}.ts'],
          name: 'main'
        }
      }
    ]
  }
})
