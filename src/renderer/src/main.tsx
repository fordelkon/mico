import './assets/tailwind.css'
import './assets/main.css'

import * as React from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import { AppearanceProvider } from './components/appearance-provider'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppearanceProvider>
      <App />
    </AppearanceProvider>
  </React.StrictMode>
)
