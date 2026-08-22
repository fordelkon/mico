import { fileURLToPath } from 'node:url'

import { defineMain } from '@storybook/react-vite/node'
import tailwindcss from '@tailwindcss/vite'
import { mergeConfig } from 'vite'

export default defineMain({
  stories: ['../stories/components/**/*.stories.@(js|jsx|ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-themes'],
  framework: '@storybook/react-vite',
  async viteFinal(config) {
    return mergeConfig(config, {
      plugins: [tailwindcss()],
      resolve: {
        alias: {
          '@mico/ui': fileURLToPath(new URL('../src', import.meta.url))
        }
      }
    })
  }
})
