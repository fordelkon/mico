import * as z from 'zod'

import { codeThemeIds, themePresetIds } from '../../theme/theme-registry'
import { defineSchema } from '../define'

const ThemePresetIdSchema = defineSchema(z.enum(themePresetIds))
const CodeThemeIdSchema = defineSchema(z.enum(codeThemeIds))
const ThemePreferencesSchema = defineSchema(
  z.object({
    appearancePreference: z.enum(['system', 'light', 'dark']),
    codeThemeDark: CodeThemeIdSchema,
    codeThemeLight: CodeThemeIdSchema,
    themePresetDark: ThemePresetIdSchema,
    themePresetLight: ThemePresetIdSchema
  })
)
const ThemeStateSchema = defineSchema(
  ThemePreferencesSchema.extend({
    activeThemePreset: ThemePresetIdSchema,
    appearance: z.enum(['light', 'dark']),
    shikiThemes: z.object({ dark: z.string(), light: z.string() })
  })
)

export { CodeThemeIdSchema, ThemePreferencesSchema, ThemePresetIdSchema, ThemeStateSchema }
