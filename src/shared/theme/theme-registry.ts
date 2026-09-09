const appearances = ['light', 'dark'] as const
const themePresetIds = [
  'mico-default',
  'nord',
  'one-nord-light',
  'tokyo-night',
  'catppuccin-mocha',
  'catppuccin-latte',
  'gruvbox-dark',
  'gruvbox-light',
  'material-palenight',
  'material-lighter',
  'rose-pine-moon',
  'rose-pine-dawn',
  'solarized-dark',
  'solarized-light',
  'vitesse-dark',
  'vitesse-light',
  'dracula',
  'monokai',
  'one-dark-pro'
] as const
const codeThemeIds = [
  'auto',
  'github-dark',
  'github-light',
  'nord',
  'tokyo-night',
  'catppuccin-mocha',
  'catppuccin-latte',
  'gruvbox-dark-medium',
  'gruvbox-light-medium',
  'material-theme-palenight',
  'material-theme-lighter',
  'rose-pine-moon',
  'rose-pine-dawn',
  'solarized-dark',
  'solarized-light',
  'vitesse-dark',
  'vitesse-light',
  'dracula',
  'monokai',
  'one-dark-pro'
] as const

type Appearance = (typeof appearances)[number]
type ThemePresetId = (typeof themePresetIds)[number]
type CodeThemeId = (typeof codeThemeIds)[number]

type ThemePreset = {
  id: ThemePresetId
  label: string
  shikiThemes: Partial<Record<Appearance, string>>
  supportedAppearances: readonly Appearance[]
  swatches: readonly string[]
}

type CodeTheme = {
  id: Exclude<CodeThemeId, 'auto'>
  label: string
  appearance: Appearance
  shikiTheme: string
}

const themePresets: readonly ThemePreset[] = [
  {
    id: 'mico-default',
    label: 'Mico Default',
    shikiThemes: { dark: 'github-dark', light: 'github-light' },
    supportedAppearances: appearances,
    swatches: ['#d97757', '#f5f4ed', '#141413', '#73726c']
  },
  {
    id: 'nord',
    label: 'Nord',
    shikiThemes: { dark: 'nord' },
    supportedAppearances: ['dark'],
    swatches: ['#2e3440', '#88c0d0', '#a3be8c', '#bf616a']
  },
  {
    id: 'one-nord-light',
    label: 'One Nord Light',
    shikiThemes: { light: 'github-light' },
    supportedAppearances: ['light'],
    swatches: ['#eceff4', '#5e81ac', '#81a1c1', '#88c0d0']
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    shikiThemes: { dark: 'tokyo-night' },
    supportedAppearances: ['dark'],
    swatches: ['#1a1b26', '#7aa2f7', '#bb9af7', '#f7768e']
  },
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    shikiThemes: { dark: 'catppuccin-mocha' },
    supportedAppearances: ['dark'],
    swatches: ['#1e1e2e', '#cba6f7', '#a6e3a1', '#f5e0dc']
  },
  {
    id: 'catppuccin-latte',
    label: 'Catppuccin Latte',
    shikiThemes: { light: 'catppuccin-latte' },
    supportedAppearances: ['light'],
    swatches: ['#eff1f5', '#8839ef', '#40a02b', '#dc8a78']
  },
  {
    id: 'gruvbox-dark',
    label: 'Gruvbox Dark',
    shikiThemes: { dark: 'gruvbox-dark-medium' },
    supportedAppearances: ['dark'],
    swatches: ['#282828', '#d79921', '#b8bb26', '#fb4934']
  },
  {
    id: 'gruvbox-light',
    label: 'Gruvbox Light',
    shikiThemes: { light: 'gruvbox-light-medium' },
    supportedAppearances: ['light'],
    swatches: ['#fbf1c7', '#b57614', '#79740e', '#cc241d']
  },
  {
    id: 'material-palenight',
    label: 'Material Palenight',
    shikiThemes: { dark: 'material-theme-palenight' },
    supportedAppearances: ['dark'],
    swatches: ['#292d3e', '#c792ea', '#82aaff', '#a6accd']
  },
  {
    id: 'material-lighter',
    label: 'Material Lighter',
    shikiThemes: { light: 'material-theme-lighter' },
    supportedAppearances: ['light'],
    swatches: ['#fafafa', '#7c4dff', '#0288d1', '#263238']
  },
  {
    id: 'rose-pine-moon',
    label: 'Rose Pine Moon',
    shikiThemes: { dark: 'rose-pine-moon' },
    supportedAppearances: ['dark'],
    swatches: ['#232136', '#c4a7e7', '#9ccfd8', '#e0def4']
  },
  {
    id: 'rose-pine-dawn',
    label: 'Rose Pine Dawn',
    shikiThemes: { light: 'rose-pine-dawn' },
    supportedAppearances: ['light'],
    swatches: ['#faf4ed', '#907aa9', '#56949f', '#575279']
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    shikiThemes: { dark: 'solarized-dark' },
    supportedAppearances: ['dark'],
    swatches: ['#002b36', '#268bd2', '#2aa198', '#fdf6e3']
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    shikiThemes: { light: 'solarized-light' },
    supportedAppearances: ['light'],
    swatches: ['#fdf6e3', '#268bd2', '#2aa198', '#073642']
  },
  {
    id: 'vitesse-dark',
    label: 'Vitesse Dark',
    shikiThemes: { dark: 'vitesse-dark' },
    supportedAppearances: ['dark'],
    swatches: ['#121212', '#4d9375', '#80a665', '#dbd7ca']
  },
  {
    id: 'vitesse-light',
    label: 'Vitesse Light',
    shikiThemes: { light: 'vitesse-light' },
    supportedAppearances: ['light'],
    swatches: ['#ffffff', '#1c6b48', '#758575', '#393a34']
  },
  {
    id: 'dracula',
    label: 'Dracula',
    shikiThemes: { dark: 'dracula' },
    supportedAppearances: ['dark'],
    swatches: ['#282a36', '#bd93f9', '#50fa7b', '#f8f8f2']
  },
  {
    id: 'monokai',
    label: 'Monokai',
    shikiThemes: { dark: 'monokai' },
    supportedAppearances: ['dark'],
    swatches: ['#272822', '#f92672', '#a6e22e', '#f8f8f2']
  },
  {
    id: 'one-dark-pro',
    label: 'One Dark Pro',
    shikiThemes: { dark: 'one-dark-pro' },
    supportedAppearances: ['dark'],
    swatches: ['#282c34', '#c678dd', '#98c379', '#abb2bf']
  }
]

const codeThemes: readonly CodeTheme[] = [
  {
    id: 'github-dark',
    label: 'GitHub Dark',
    appearance: 'dark',
    shikiTheme: 'github-dark'
  },
  {
    id: 'github-light',
    label: 'GitHub Light',
    appearance: 'light',
    shikiTheme: 'github-light'
  },
  { id: 'nord', label: 'Nord', appearance: 'dark', shikiTheme: 'nord' },
  { id: 'tokyo-night', label: 'Tokyo Night', appearance: 'dark', shikiTheme: 'tokyo-night' },
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    appearance: 'dark',
    shikiTheme: 'catppuccin-mocha'
  },
  {
    id: 'catppuccin-latte',
    label: 'Catppuccin Latte',
    appearance: 'light',
    shikiTheme: 'catppuccin-latte'
  },
  {
    id: 'gruvbox-dark-medium',
    label: 'Gruvbox Dark',
    appearance: 'dark',
    shikiTheme: 'gruvbox-dark-medium'
  },
  {
    id: 'gruvbox-light-medium',
    label: 'Gruvbox Light',
    appearance: 'light',
    shikiTheme: 'gruvbox-light-medium'
  },
  {
    id: 'material-theme-palenight',
    label: 'Material Palenight',
    appearance: 'dark',
    shikiTheme: 'material-theme-palenight'
  },
  {
    id: 'material-theme-lighter',
    label: 'Material Lighter',
    appearance: 'light',
    shikiTheme: 'material-theme-lighter'
  },
  {
    id: 'rose-pine-moon',
    label: 'Rose Pine Moon',
    appearance: 'dark',
    shikiTheme: 'rose-pine-moon'
  },
  {
    id: 'rose-pine-dawn',
    label: 'Rose Pine Dawn',
    appearance: 'light',
    shikiTheme: 'rose-pine-dawn'
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    appearance: 'dark',
    shikiTheme: 'solarized-dark'
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    appearance: 'light',
    shikiTheme: 'solarized-light'
  },
  { id: 'vitesse-dark', label: 'Vitesse Dark', appearance: 'dark', shikiTheme: 'vitesse-dark' },
  {
    id: 'vitesse-light',
    label: 'Vitesse Light',
    appearance: 'light',
    shikiTheme: 'vitesse-light'
  },
  { id: 'dracula', label: 'Dracula', appearance: 'dark', shikiTheme: 'dracula' },
  { id: 'monokai', label: 'Monokai', appearance: 'dark', shikiTheme: 'monokai' },
  { id: 'one-dark-pro', label: 'One Dark Pro', appearance: 'dark', shikiTheme: 'one-dark-pro' }
]

function getThemePresets(appearance: Appearance): readonly ThemePreset[] {
  return themePresets.filter(({ supportedAppearances }) =>
    supportedAppearances.includes(appearance)
  )
}

function getCodeThemes(appearance: Appearance): readonly CodeThemeId[] {
  return [
    'auto',
    ...codeThemes.filter((theme) => theme.appearance === appearance).map(({ id }) => id)
  ]
}

function getCodeThemeLabel(codeThemeId: CodeThemeId): string {
  if (codeThemeId === 'auto') return 'Follow preset'
  return codeThemes.find(({ id }) => id === codeThemeId)?.label ?? codeThemeId
}

function resolveCodeTheme(
  appearance: Appearance,
  codeThemeId: CodeThemeId,
  presetId: ThemePresetId = 'mico-default'
): string {
  if (codeThemeId !== 'auto') {
    const codeTheme = codeThemes.find(({ id }) => id === codeThemeId)
    if (codeTheme?.appearance === appearance) return codeTheme.shikiTheme
  }

  return (
    themePresets.find(({ id }) => id === presetId)?.shikiThemes[appearance] ??
    (appearance === 'light' ? 'github-light' : 'github-dark')
  )
}

function isThemePresetId(value: string): value is ThemePresetId {
  return themePresetIds.some((id) => id === value)
}

function isCodeThemeId(value: string): value is CodeThemeId {
  return codeThemeIds.some((id) => id === value)
}

export {
  appearances,
  codeThemeIds,
  getCodeThemes,
  getCodeThemeLabel,
  getThemePresets,
  isCodeThemeId,
  isThemePresetId,
  resolveCodeTheme,
  themePresetIds,
  type Appearance,
  type CodeThemeId,
  type ThemePreset,
  type ThemePresetId
}
