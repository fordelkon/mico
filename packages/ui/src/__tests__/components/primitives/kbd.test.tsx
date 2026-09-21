import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Kbd } from '../../../components/primitives/kbd'

describe('Kbd', () => {
  it('user reads the shortcut when it has a tooltip, then the shortcut text and tooltip are shown', () => {
    render(<Kbd title="New chat shortcut">⌘ N</Kbd>)

    expect(screen.getByText('⌘ N')).toBeVisible()
    expect(screen.getByText('⌘ N')).toHaveAttribute('title', 'New chat shortcut')
  })
})
