import '../stories/tailwind.css'

import { withThemeByClassName } from '@storybook/addon-themes'
import type { Preview } from '@storybook/react'

const preview: Preview = {
  parameters: {
    backgrounds: {
      options: {
        dark: { name: 'Dark', value: 'oklch(0.145 0 0)' },
        light: { name: 'Light', value: 'oklch(1 0 0)' }
      }
    }
  },
  decorators: [
    withThemeByClassName({
      themes: {
        dark: 'dark',
        light: ''
      },
      defaultTheme: 'light'
    })
  ]
}

export default preview
