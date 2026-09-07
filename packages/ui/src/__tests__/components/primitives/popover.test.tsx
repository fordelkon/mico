import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Popover, PopoverContent, PopoverTrigger } from '../../../index'

describe('Popover', () => {
  it('exposes portal content through the public package entry point when open', () => {
    render(
      <Popover open>
        <PopoverTrigger>Model options</PopoverTrigger>
        <PopoverContent>Choose a model</PopoverContent>
      </Popover>
    )

    expect(screen.getByRole('button', { name: 'Model options' })).toBeInTheDocument()
    expect(screen.getByText('Choose a model')).toBeVisible()
  })

  it('does not render portal content when closed', () => {
    render(
      <Popover open={false}>
        <PopoverTrigger>Model options</PopoverTrigger>
        <PopoverContent>Choose a model</PopoverContent>
      </Popover>
    )

    expect(screen.queryByText('Choose a model')).not.toBeInTheDocument()
  })
})
