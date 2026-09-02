import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Kbd } from '../../../components/primitives/kbd'

describe('Kbd', () => {
  it('renders an extensible semantic keyboard key', () => {
    render(
      <Kbd className="custom-class" title="New chat shortcut">
        ⌘ N
      </Kbd>
    )

    expect(screen.getByText('⌘ N').tagName).toBe('KBD')
    expect(screen.getByText('⌘ N')).toHaveClass('custom-class')
    expect(screen.getByText('⌘ N')).toHaveAttribute('title', 'New chat shortcut')
  })
})
