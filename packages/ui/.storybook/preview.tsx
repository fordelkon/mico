import '../stories/tailwind.css'

import { withThemeByClassName } from '@storybook/addon-themes'
import type { Preview } from '@storybook/react'

const preview: Preview = {
  parameters: {
    backgrounds: {
      options: {
        dark: { name: 'Dark', value: '#262624' },
        light: { name: 'Light', value: '#faf9f5' }
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
