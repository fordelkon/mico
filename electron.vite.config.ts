import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      externalizeDeps: {
        exclude: ['@mico/ai-providers', '@mico/agent-core', '@mico/coding-agent']
      },
      rollupOptions: {
        input: {
          index: resolve('src/main/main.ts')
        }
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: {
        exclude: ['@mico/coding-agent']
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    build: {
      assetsInlineLimit: 0
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
