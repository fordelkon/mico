import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import {
  Sidebar,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarResizeHandle,
  SidebarTrigger,
  useSidebar
} from '../../../components/primitives/sidebar'

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

  it('clamps pointer resizing at the configured maximum', () => {
    render(
      <SidebarProvider resize={{ defaultWidth: 240, maxWidth: 320, minWidth: 180 }}>
        <SidebarResizeHandle />
      </SidebarProvider>
    )

    const resizeHandle = screen.getByRole('separator', { name: 'Resize Sidebar' })

    fireEvent.pointerDown(resizeHandle, { clientX: 240, pointerId: 7 })
    fireEvent.pointerMove(resizeHandle, { clientX: 400, pointerId: 7 })

    expect(resizeHandle).toHaveAttribute('aria-valuenow', '320')

    fireEvent.pointerUp(resizeHandle, { pointerId: 7 })
  })

  it('resizes by eight pixels from the keyboard', () => {
    render(
      <SidebarProvider resize={{ defaultWidth: 240, maxWidth: 320, minWidth: 180 }}>
        <Sidebar>
          <SidebarResizeHandle />
        </Sidebar>
      </SidebarProvider>
    )

    const resizeHandle = screen.getByRole('separator', { name: 'Resize Sidebar' })

    fireEvent.keyDown(resizeHandle, { key: 'ArrowRight' })

    expect(resizeHandle).toHaveAttribute('aria-valuenow', '248')
  })

  it('removes resizing while collapsed and restores the remembered width', async () => {
    const user = userEvent.setup()

    render(
      <SidebarProvider resize={{ defaultWidth: 240, maxWidth: 320, minWidth: 180 }}>
        <Sidebar>
          <SidebarResizeHandle />
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>
    )

    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize Sidebar' }), {
      key: 'ArrowRight'
    })
    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }))

    expect(screen.queryByRole('separator', { name: 'Resize Sidebar' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }))

    expect(screen.getByRole('separator', { name: 'Resize Sidebar' })).toHaveAttribute(
      'aria-valuenow',
      '248'
    )
  })
})
