import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar
} from '../sidebar'

function SidebarState() {
  const { state } = useSidebar()

  return <output aria-label="Sidebar state">{state}</output>
}

describe('Sidebar', () => {
  it('toggles the sidebar state from its trigger', async () => {
    const user = userEvent.setup()

    render(
      <SidebarProvider defaultOpen>
        <SidebarTrigger />
        <SidebarState />
      </SidebarProvider>
    )

    expect(screen.getByRole('status', { name: 'Sidebar state' })).toHaveTextContent('expanded')

    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }))

    expect(screen.getByRole('status', { name: 'Sidebar state' })).toHaveTextContent('collapsed')
  })

  it('provides tooltip context to menu buttons', () => {
    render(
      <SidebarProvider defaultOpen={false}>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Home">Home</SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarProvider>
    )

    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument()
  })
})
