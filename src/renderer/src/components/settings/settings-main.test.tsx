import '@testing-library/jest-dom/vitest'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { SettingsMain } from './settings-main'

describe('SettingsMain', () => {
  it('switches the empty provider section when a provider is selected', async () => {
    const user = userEvent.setup()

    render(<SettingsMain />)

    expect(screen.getByRole('button', { name: 'Ollama' })).toHaveAttribute('aria-current', 'page')

    await user.click(screen.getByRole('button', { name: 'LM Studio' }))

    expect(screen.getByRole('heading', { level: 2, name: 'LM Studio' })).toBeVisible()
  })

  it('keeps the settings content panel and unsaved-change actions visible', () => {
    render(<SettingsMain />)

    expect(screen.getByRole('main', { name: 'Provider configuration' })).toBeVisible()
    expect(screen.getByText('All changes saved')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Close' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('filters the expanded provider rail by the entered provider name', async () => {
    const user = userEvent.setup()

    render(<SettingsMain />)

    await user.click(screen.getByRole('button', { name: 'Search providers' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search providers' }), 'studio')

    expect(screen.getByRole('button', { name: 'LM Studio' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Ollama' })).not.toBeInTheDocument()
  })

  it('opens the provider search only after the search control is clicked', async () => {
    const user = userEvent.setup()

    render(<SettingsMain />)

    await user.hover(screen.getByRole('navigation', { name: 'Providers' }))

    expect(screen.queryByRole('searchbox', { name: 'Search providers' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Search providers' }))

    expect(screen.getByRole('searchbox', { name: 'Search providers' })).toBeVisible()
  })

  it('collapses the provider rail after its search loses focus outside the rail', async () => {
    const user = userEvent.setup()

    render(<SettingsMain />)

    const rail = screen.getByRole('navigation', { name: 'Providers' })
    await user.click(screen.getByRole('button', { name: 'Search providers' }))
    await user.unhover(rail)
    await user.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => {
      expect(screen.queryByRole('searchbox', { name: 'Search providers' })).not.toBeInTheDocument()
    })
  })
})
