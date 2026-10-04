import { Separator } from '@mico/ui'
import { type Appearance, getCodeThemes, getThemePresets } from '@shared/theme/theme-registry'
import { Monitor, Moon, Palette, Sun } from 'lucide-react'
import * as React from 'react'

import { useAppearance } from '../../appearance-provider'
import { CodeThemeMenu } from './code-theme-menu'
import './appearance-settings.css'

const modeLabels = { dark: 'Dark Mode Theme', light: 'Light Mode Theme' } as const
const appearanceOptions = [
  { icon: Sun, label: 'Light', value: 'light' },
  { icon: Moon, label: 'Dark', value: 'dark' },
  { icon: Monitor, label: 'System', value: 'system' }
] as const

function ThemePreferenceSection(): React.JSX.Element {
  const { preference, setPreference } = useAppearance()

  return (
    <section aria-labelledby="theme-heading" className="appearance-settings__section">
      <div className="appearance-settings__section-heading">
        <Palette aria-hidden="true" />
        <div>
          <h2 id="theme-heading">Theme</h2>
          <p>Choose how Mico matches your preferred appearance.</p>
        </div>
      </div>
      <div
        aria-label="Theme preference"
        className="appearance-settings__theme-cards"
        role="radiogroup"
      >
        {appearanceOptions.map(({ icon: Icon, label, value }) => {
          const selected = preference === value
          return (
            <button
              aria-checked={selected}
              className="appearance-settings__theme-card"
              key={value}
              onClick={() => void setPreference(value)}
              role="radio"
              type="button"
            >
              <span
                aria-hidden="true"
                className="appearance-settings__theme-preview"
                data-appearance={value}
              >
                <Icon />
              </span>
              <span>{label}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function AppearanceSection({ appearance }: { appearance: Appearance }): React.JSX.Element {
  const { setThemePreferences, theme } = useAppearance()
  const selectedPreset = appearance === 'light' ? theme.themePresetLight : theme.themePresetDark
  const selectedCodeTheme = appearance === 'light' ? theme.codeThemeLight : theme.codeThemeDark
  const update = (
    change: Partial<
      Pick<
        typeof theme,
        'codeThemeDark' | 'codeThemeLight' | 'themePresetDark' | 'themePresetLight'
      >
    >
  ): void => {
    void setThemePreferences({
      appearancePreference: theme.appearancePreference,
      codeThemeDark: theme.codeThemeDark,
      codeThemeLight: theme.codeThemeLight,
      themePresetDark: theme.themePresetDark,
      themePresetLight: theme.themePresetLight,
      ...change
    })
  }
  const selectCodeTheme = (value: string): void => {
    const codeTheme = getCodeThemes(appearance).find((id) => id === value) ?? 'auto'
    update(appearance === 'light' ? { codeThemeLight: codeTheme } : { codeThemeDark: codeTheme })
  }

  return (
    <section
      className="appearance-settings__section"
      aria-labelledby={`${appearance}-theme-heading`}
    >
      <div className="appearance-settings__section-header">
        <div className="appearance-settings__section-heading">
          {appearance === 'light' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          <div>
            <h2 id={`${appearance}-theme-heading`}>{modeLabels[appearance]}</h2>
            <p>Select a color scheme for {appearance} mode.</p>
          </div>
        </div>
        <div className="appearance-settings__code-theme">
          <span>Code theme</span>
          <CodeThemeMenu
            appearance={appearance}
            onValueChange={selectCodeTheme}
            codeThemes={getCodeThemes(appearance)}
            value={selectedCodeTheme}
          />
        </div>
      </div>
      <div
        aria-label={`${appearance} themes`}
        className="appearance-settings__cards"
        role="radiogroup"
      >
        {getThemePresets(appearance).map((preset) => {
          const selected = preset.id === selectedPreset
          return (
            <button
              aria-checked={selected}
              className="appearance-settings__card"
              key={preset.id}
              onClick={() =>
                update(
                  appearance === 'light'
                    ? { themePresetLight: preset.id }
                    : { themePresetDark: preset.id }
                )
              }
              role="radio"
              type="button"
            >
              <span aria-hidden="true" className="appearance-settings__swatches">
                {preset.swatches.map((color) => (
                  <i key={color} style={{ backgroundColor: color }} />
                ))}
              </span>
              <span>{preset.label}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function AppearanceSettings(): React.JSX.Element {
  const { appearance, preference, error } = useAppearance()
  const selectedAppearance = preference === 'system' ? appearance : preference

  return (
    <div className="paper-canvas flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 px-8 py-6">
        <div className="flex items-center gap-2">
          <Palette aria-hidden="true" className="size-5 text-text-secondary" />
          <h1 className="text-xl font-semibold text-text-primary">Appearance</h1>
        </div>
      </header>
      <Separator className="bg-border-subtle" />
      <main className="appearance-settings__content min-h-0 flex-1 overflow-y-auto p-6">
        {error && <p role="alert">{error}</p>}
        <ThemePreferenceSection />
        <AppearanceSection appearance={selectedAppearance} />
      </main>
    </div>
  )
}

export { AppearanceSettings }
