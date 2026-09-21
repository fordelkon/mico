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

function renderResizable(children: React.ReactNode) {
  render(
    <SidebarProvider resize={{ defaultWidth: 240, maxWidth: 320, minWidth: 180 }}>
      {children}
    </SidebarProvider>
  )
}

describe('Sidebar', () => {
  it('user clicks the trigger when the sidebar is open, then it collapses', async () => {
    const user = userEvent.setup()

    render(
      <SidebarProvider defaultOpen>
        <SidebarTrigger />
        <SidebarState />
      </SidebarProvider>
    )

    const state = screen.getByRole('status', { name: 'Sidebar state' })

    expect(state).toHaveTextContent('expanded')

    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }))

    expect(state).toHaveTextContent('collapsed')
  })

  it('user sees the menu button when the sidebar provides a tooltip, then it renders', () => {
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

  it('user drags the resize handle when past the max, then the width clamps at 320', () => {
    renderResizable(<SidebarResizeHandle />)

    const resizeHandle = screen.getByRole('separator', { name: 'Resize Sidebar' })

    fireEvent.pointerDown(resizeHandle, { clientX: 240, pointerId: 7 })
    fireEvent.pointerMove(resizeHandle, { clientX: 400, pointerId: 7 })

    expect(resizeHandle).toHaveAttribute('aria-valuenow', '320')

    fireEvent.pointerUp(resizeHandle, { pointerId: 7 })
  })

  it('user presses ArrowRight when resizing, then the width grows by eight pixels', () => {
    renderResizable(
      <Sidebar>
        <SidebarResizeHandle />
      </Sidebar>
    )

    const resizeHandle = screen.getByRole('separator', { name: 'Resize Sidebar' })

    fireEvent.keyDown(resizeHandle, { key: 'ArrowRight' })

    expect(resizeHandle).toHaveAttribute('aria-valuenow', '248')
  })

  it('user restores the sidebar when it was collapsed, then the width is remembered', async () => {
    const user = userEvent.setup()

    renderResizable(
      <>
        <Sidebar>
          <SidebarResizeHandle />
        </Sidebar>
        <SidebarTrigger />
      </>
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
