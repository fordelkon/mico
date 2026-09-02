import * as React from 'react'

import { cn } from '@mico/ui/lib/utils'

type IconSwapProps = Omit<React.ComponentProps<'span'>, 'aria-hidden' | 'children'> & {
  /** Icon visible when `state` is `from`. */
  from: React.ReactNode
  /** Controls which icon is visible. Both icons remain mounted for the transition. */
  state: 'from' | 'to'
  /** Icon visible when `state` is `to`. */
  to: React.ReactNode
}

/** Swaps two decorative icons with a fade-and-scale transition. */
function IconSwap({ className, from, state, to, ...props }: IconSwapProps): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn('group/icon-swap relative inline-grid size-5', className)}
      data-slot="icon-swap"
      data-state={state}
      {...props}
    >
      <span className="col-start-1 row-start-1 inline-flex items-center justify-center opacity-100 transition-[opacity,transform] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-data-[state=to]/icon-swap:scale-60 group-data-[state=to]/icon-swap:opacity-0 motion-reduce:transition-none">
        {from}
      </span>
      <span className="col-start-1 row-start-1 inline-flex scale-60 items-center justify-center opacity-0 transition-[opacity,transform] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-data-[state=to]/icon-swap:scale-100 group-data-[state=to]/icon-swap:opacity-100 motion-reduce:transition-none">
        {to}
      </span>
    </span>
  )
}

export { IconSwap, type IconSwapProps }
