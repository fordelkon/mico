import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../tooltip'

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
  it('renders accessible content through a portal when open', () => {
    renderTooltip(true)

    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument()
    expect(screen.getByRole('tooltip')).toHaveTextContent('More information')
  })

  it('does not render content when closed', () => {
    renderTooltip(false)

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
