import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': fileURLToPath(new URL('./src/renderer/src', import.meta.url))
    }
  },
  test: {
    environment: 'jsdom',
    include: ['src/renderer/src/**/*.{test,spec}.{ts,tsx}', 'src/shared/**/*.{test,spec}.ts'],
    setupFiles: ['./src/renderer/test/setup.ts']
  }
})
