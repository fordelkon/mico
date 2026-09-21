import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Popover, PopoverContent, PopoverTrigger } from '../../../index'

describe('Popover', () => {
  it('user sees the popover content when it is open, then it renders in the portal', () => {
    render(
      <Popover open>
        <PopoverTrigger>Model options</PopoverTrigger>
        <PopoverContent>Choose a model</PopoverContent>
      </Popover>
    )

    expect(screen.getByRole('button', { name: 'Model options' })).toBeInTheDocument()
    expect(screen.getByText('Choose a model')).toBeVisible()
  })

  it('user sees no popover content when it is closed, then nothing renders', () => {
    render(
      <Popover open={false}>
        <PopoverTrigger>Model options</PopoverTrigger>
        <PopoverContent>Choose a model</PopoverContent>
      </Popover>
    )

    expect(screen.queryByText('Choose a model')).not.toBeInTheDocument()
  })
})
