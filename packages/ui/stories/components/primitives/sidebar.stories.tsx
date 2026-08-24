import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarResizeHandle,
  SidebarTrigger
} from '@mico/ui'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { HomeIcon, MessagesSquareIcon, SettingsIcon } from 'lucide-react'

const navigationItems = [
  { label: 'Home', icon: HomeIcon },
  { label: 'Conversations', icon: MessagesSquareIcon },
  { label: 'Settings', icon: SettingsIcon }
]

const meta = {
  title: 'Components/Primitives/Sidebar',
  component: Sidebar,
  parameters: {
    layout: 'fullscreen'
  },
  tags: ['autodocs']
} satisfies Meta<typeof Sidebar>

export default meta
type Story = StoryObj<typeof meta>

function SidebarExample({
  defaultOpen = true,
  resizable = false
}: {
  defaultOpen?: boolean
  resizable?: boolean
}) {
  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      resize={resizable ? { defaultWidth: 256, maxWidth: 360, minWidth: 200 } : undefined}
    >
      <Sidebar collapsible="icon">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navigationItems.map((item) => (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton tooltip={item.label}>
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        {resizable ? <SidebarResizeHandle /> : null}
      </Sidebar>
      <SidebarInset>
        <header className="flex h-12 items-center border-b px-4">
          <SidebarTrigger />
        </header>
        <main className="p-4">Sidebar content area</main>
      </SidebarInset>
    </SidebarProvider>
  )
}

export const Default: Story = {
  render: () => <SidebarExample />
}

export const Collapsed: Story = {
  render: () => <SidebarExample defaultOpen={false} />
}

export const Resizable: Story = {
  render: () => <SidebarExample resizable />
}
