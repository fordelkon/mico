import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ThinkingBlock } from './thinking-block'

describe('ThinkingBlock', () => {
  it('keeps a thinking icon visible after streaming finishes', () => {
    render(<ThinkingBlock id="reasoning-1" isStreaming={false} text="Inspecting the request." />)

    expect(
      screen.getByRole('button', { name: 'Thinking' }).querySelector('svg')
    ).toBeInTheDocument()
  })
})
