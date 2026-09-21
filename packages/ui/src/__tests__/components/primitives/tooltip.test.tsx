import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '../../../components/primitives/tooltip'

function renderTooltip(open: boolean) {
  render(
    <TooltipProvider>
      <Tooltip open={open}>
        <TooltipTrigger asChild>
          <button type="button">Details</button>
        </TooltipTrigger>
        <TooltipContent>More information</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

describe('Tooltip', () => {
  it('user sees the tooltip content when it is open, then it renders accessibly', () => {
    renderTooltip(true)

    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument()
    expect(screen.getByRole('tooltip')).toHaveTextContent('More information')
  })

  it('user sees no tooltip content when it is closed, then nothing is rendered', () => {
    renderTooltip(false)

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
