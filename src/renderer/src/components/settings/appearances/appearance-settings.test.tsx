import '@testing-library/jest-dom/vitest'

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataFor } from '@shared/data/types'
import type { AppearanceAPI } from '@shared/ipc/schemas/appearance'

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
  getThemeState: vi.fn<AppearanceAPI['getThemeState']>(),
  onThemeChange: vi.fn<AppearanceAPI['onThemeChange']>(() => () => undefined),
  setPreference: vi.fn<AppearanceAPI['setPreference']>(),
  setThemePreferences: vi.fn<AppearanceAPI['setThemePreferences']>()
}

function renderAppearanceSettings(): void {
  render(
    <AppearanceProvider>
      <AppearanceSettings />
    </AppearanceProvider>
  )
}

describe('AppearanceSettings', () => {
  beforeEach(() => {
    appearanceApi.getThemeState.mockReset()
    appearanceApi.getThemeState.mockResolvedValue(initialTheme)
    appearanceApi.onThemeChange.mockClear()
    appearanceApi.setPreference.mockReset()
    appearanceApi.setPreference.mockImplementation(async (preference) => ({
      ...initialTheme,
      appearancePreference: preference,
      appearance: preference === 'system' ? 'dark' : preference
    }))
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

  it('user sees the document root update when a preset saves, then attributes match', async () => {
    const user = userEvent.setup()
    renderAppearanceSettings()

    await screen.findByRole('radio', { name: 'Tokyo Night' })
    await user.click(screen.getByRole('radio', { name: 'Tokyo Night' }))

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-theme-preset', 'tokyo-night')
      expect(document.documentElement).toHaveAttribute('data-appearance', 'dark')
    })
  })

  it('user receives a theme update when the initial read is delayed, then the newer theme stays visible', async () => {
    const pending = Promise.withResolvers<ThemeState>()
    appearanceApi.getThemeState.mockReturnValueOnce(pending.promise)
    renderAppearanceSettings()
    const notify = appearanceApi.onThemeChange.mock.calls.at(-1)?.[0]
    if (!notify) throw new Error('Theme changes must be subscribed before reading.')
    act(() => notify({ ...initialTheme, appearance: 'light', appearancePreference: 'light' }))
    await act(async () => {
      pending.resolve(initialTheme)
      await pending.promise
    })
    expect(document.documentElement).toHaveAttribute('data-appearance', 'light')
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')
  })

  it('user changes appearance when saving fails, then the committed theme remains selected', async () => {
    const user = userEvent.setup()
    appearanceApi.setPreference.mockRejectedValueOnce(new Error('Storage unavailable'))
    renderAppearanceSettings()
    await screen.findByRole('heading', { name: 'Dark Mode Theme' })
    await user.click(screen.getByRole('radio', { name: 'Light' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save appearance settings')
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true')
    expect(document.documentElement).toHaveAttribute('data-appearance', 'dark')
  })

  it('user sees the Dark card selected when picked, then the preference is persisted', async () => {
    const user = userEvent.setup()
    renderAppearanceSettings()

    const darkTheme = await screen.findByRole('radio', { name: 'Dark' })
    await user.click(darkTheme)

    expect(appearanceApi.setPreference).toHaveBeenCalledWith('dark')
    expect(darkTheme).toHaveAttribute('aria-checked', 'true')
  })

  it('user sees one mode theme when preference is system, then the other is absent', async () => {
    renderAppearanceSettings()

    expect(await screen.findByRole('heading', { name: 'Dark Mode Theme' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Light Mode Theme' })).not.toBeInTheDocument()
  })
})
