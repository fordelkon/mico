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

function SidebarExample({ defaultOpen = true }: { defaultOpen?: boolean }) {
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
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
