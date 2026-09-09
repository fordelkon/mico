import '@testing-library/jest-dom/vitest'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataFor } from '@shared/data/types'

import { AppearanceProvider } from '../../appearance-provider'
import { AppearanceSettings } from './appearance-settings'

type ThemePreferences = DataFor<'themePreferences'>
type ThemeState = DataFor<'themeState'>

const initialTheme: ThemeState = {
  activeThemePreset: 'mico-default',
  appearance: 'dark',
  appearancePreference: 'system',
  codeThemeDark: 'auto',
  codeThemeLight: 'auto',
  shikiThemes: { dark: 'github-dark', light: 'github-light' },
  themePresetDark: 'mico-default',
  themePresetLight: 'mico-default'
}

const appearanceApi = {
  getThemeState: vi.fn(),
  onAppearanceChange: vi.fn(() => () => undefined),
  onThemeChange: vi.fn(() => () => undefined),
  setPreference: vi.fn(),
  setThemePreferences: vi.fn()
}

describe('AppearanceSettings', () => {
  beforeEach(() => {
    appearanceApi.getThemeState.mockReset()
    appearanceApi.getThemeState.mockResolvedValue(initialTheme)
    appearanceApi.onAppearanceChange.mockClear()
    appearanceApi.onThemeChange.mockClear()
    appearanceApi.setThemePreferences.mockReset()
    appearanceApi.setThemePreferences.mockImplementation(
      async (preferences: ThemePreferences): Promise<ThemeState> => ({
        ...initialTheme,
        ...preferences,
        activeThemePreset: preferences.themePresetDark
      })
    )
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { appearance: appearanceApi }
    })
  })

  it('applies a selected dark preset to the document root after it is persisted', async () => {
    const user = userEvent.setup()
    render(
      <AppearanceProvider>
        <AppearanceSettings />
      </AppearanceProvider>
    )

    await screen.findByRole('radio', { name: 'Tokyo Night' })
    await user.click(screen.getByRole('radio', { name: 'Tokyo Night' }))

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-theme-preset', 'tokyo-night')
      expect(document.documentElement).toHaveAttribute('data-appearance', 'dark')
    })
  })
})
