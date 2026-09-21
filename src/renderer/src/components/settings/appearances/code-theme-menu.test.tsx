import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { CodeThemeId } from '@shared/theme/theme-registry'

import { CodeThemeMenu } from './code-theme-menu'

describe('CodeThemeMenu', () => {
  it('user filters code themes when typing in search, then selecting one commits it', async () => {
    const onValueChange = vi.fn<(value: CodeThemeId) => void>()
    const user = userEvent.setup()

    render(
      <CodeThemeMenu
        appearance="dark"
        codeThemes={['auto', 'github-dark', 'dracula']}
        onValueChange={onValueChange}
        value="auto"
      />
    )

    await user.click(screen.getByRole('button', { name: 'dark code theme' }))
    await user.type(screen.getByRole('textbox', { name: 'Search dark code themes' }), 'drac')

    expect(screen.getByRole('option', { name: 'Dracula' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'GitHub Dark' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: 'Dracula' }))

    expect(onValueChange).toHaveBeenCalledOnce()
    expect(onValueChange).toHaveBeenCalledWith('dracula')
    expect(screen.queryByRole('listbox', { name: 'dark code themes' })).not.toBeInTheDocument()
  })
})
