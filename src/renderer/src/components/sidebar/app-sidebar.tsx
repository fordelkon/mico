import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  IconTooltipButton,
  IconSwap,
  Kbd,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarResizeHandle,
  useSidebar
} from '@mico/ui'
import type { Conversation } from '@renderer/types/chat'
import { ArrowLeft, Bot, Moon, Palette, PanelLeft, Search, Settings, SquarePen } from 'lucide-react'
import * as React from 'react'

import { useAppearance } from '../appearance-provider'
import { ConversationRow } from './conversation-row'
import './app-sidebar.css'

type AppSidebarProps = {
  conversations: Conversation[]
  activeConversationId: string | null
  respondingConversationIds: ReadonlySet<string>
  onDeleteConversation: (conversationId: string) => void
  onBackFromSettings: () => void
  onNewChat: () => void
  onOpenSettings: () => void
  onRenameConversation: (conversationId: string, title: string) => void
  onSelectConversation: (conversationId: string, options?: { focusComposer?: boolean }) => void
  onSelectSettingsPage?: (page: 'providers' | 'appearance') => void
  settingsPage?: 'providers' | 'appearance'
  settingsActive: boolean
}

const appearancePreferenceLabels = {
  dark: 'Dark',
  light: 'Light',
  system: 'System'
} as const

function nextAppearancePreference(preference: keyof typeof appearancePreferenceLabels) {
  if (preference === 'system') return 'light'
  if (preference === 'light') return 'dark'
  return 'system'
}

function AppSidebar({
  conversations,
  activeConversationId,
  respondingConversationIds,
  onDeleteConversation,
  onBackFromSettings,
  onNewChat,
  onOpenSettings,
  onRenameConversation,
  onSelectConversation,
  onSelectSettingsPage,
  settingsPage = 'providers',
  settingsActive
}: AppSidebarProps): React.JSX.Element {
  const { state, toggleSidebar } = useSidebar()
  const { preference, setPreference } = useAppearance()
  const collapsed = state === 'collapsed'
  const [searchOpen, setSearchOpen] = React.useState(false)

  // Keep the new-chat shortcut available while focus is inside any sidebar control.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const isMacOS = window.electron.process.platform === 'darwin'
      const modifierPressed = isMacOS ? event.metaKey : event.ctrlKey
      if (!modifierPressed || event.key.toLowerCase() !== 'n') return

      event.preventDefault()
      onNewChat()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onNewChat])

  return (
    <>
      <Sidebar
        aria-label="Sidebar"
        className="app-sidebar font-mono"
        collapsible="offcanvas"
        variant="floating"
      >
        <SidebarContent className="pt-[60px]">
          <SidebarGroup>
            {settingsActive ? (
              <SidebarMenu aria-label="Settings">
                <SidebarMenuItem className="mx-1.5 my-px">
                  <SidebarMenuButton
                    aria-current={settingsPage === 'providers' ? 'page' : undefined}
                    className="h-[34px] rounded-lg px-[10px] text-[13px] font-normal text-text-secondary transition-colors hover:bg-sidebar-row-hover hover:text-text-secondary data-[active=true]:bg-sidebar-row-active data-[active=true]:text-text-secondary"
                    isActive={settingsPage === 'providers'}
                    onClick={() => onSelectSettingsPage?.('providers')}
                    tooltip="Providers"
                  >
                    <Bot aria-hidden="true" />
                    <span>Providers</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem className="mx-1.5 my-px">
                  <SidebarMenuButton
                    aria-current={settingsPage === 'appearance' ? 'page' : undefined}
                    className="h-[34px] rounded-lg px-[10px] text-[13px] font-normal text-text-secondary transition-colors hover:bg-sidebar-row-hover hover:text-text-secondary data-[active=true]:bg-sidebar-row-active data-[active=true]:text-text-secondary"
                    isActive={settingsPage === 'appearance'}
                    onClick={() => onSelectSettingsPage?.('appearance')}
                    tooltip="Appearance"
                  >
                    <Palette aria-hidden="true" />
                    <span>Appearance</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            ) : conversations.length > 0 ? (
              <SidebarMenu>
                {conversations.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    isResponding={respondingConversationIds.has(conversation.id)}
                    selected={conversation.id === activeConversationId}
                    onDeleteConversation={onDeleteConversation}
                    onRenameConversation={onRenameConversation}
                    onSelectConversation={onSelectConversation}
                  />
                ))}
              </SidebarMenu>
            ) : (
              <div
                aria-label="Empty conversations"
                className="flex flex-col items-center gap-0.5 px-2 py-3 text-center"
              >
                <span className="text-base leading-[1.35] text-text-secondary">Clear History</span>
                <span className="text-[11px] leading-[1.4] text-text-tertiary">New Chat</span>
              </div>
            )}
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          {!settingsActive && (
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={onOpenSettings} tooltip="Settings">
                  <Settings aria-hidden="true" />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          )}
        </SidebarFooter>
        <SidebarResizeHandle className="app-sidebar__resize-handle" />
      </Sidebar>

      <header className="app-sidebar__toolbar titlebar-control-group">
        <IconTooltipButton
          aria-expanded={!collapsed}
          className="app-sidebar__toggle titlebar-button"
          icon={<PanelLeft aria-hidden="true" className="app-sidebar__toggle-icon" />}
          label="Toggle sidebar"
          onClick={toggleSidebar}
          tooltip={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        />
        <IconTooltipButton
          className="titlebar-button"
          icon={<Search aria-hidden="true" />}
          label="Search threads"
          onClick={() => setSearchOpen(true)}
          tooltip="Search commands"
        />
        <IconTooltipButton
          className="titlebar-button"
          icon={
            <IconSwap
              from={<SquarePen />}
              className="size-[13px]"
              state={settingsActive ? 'to' : 'from'}
              to={<ArrowLeft />}
            />
          }
          label={settingsActive ? 'Back' : 'New chat'}
          onClick={settingsActive ? onBackFromSettings : onNewChat}
          tooltip={
            settingsActive ? (
              'Back'
            ) : (
              <>
                <span>New chat</span>
                <Kbd>⌘ N</Kbd>
              </>
            )
          }
        />
      </header>
      <CommandDialog
        className="app-sidebar__search-command-dialog"
        description="Search threads and application actions"
        onOpenChange={setSearchOpen}
        open={searchOpen}
        title="Search"
      >
        <CommandInput placeholder="Search threads and actions..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Quick Actions">
            <CommandItem
              onSelect={() => {
                void setPreference(nextAppearancePreference(preference))
              }}
              value="theme system light dark"
            >
              <Moon aria-hidden="true" />
              Theme
              <CommandShortcut>{appearancePreferenceLabels[preference]}</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
        <div aria-hidden="true" className="app-sidebar__search-command-footer">
          <span className="app-sidebar__search-command-hint">
            <span className="app-sidebar__search-command-key-pair">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
            </span>
            navigate
          </span>
          <span className="app-sidebar__search-command-hint">
            <Kbd>↵</Kbd>
            select
          </span>
          <span className="app-sidebar__search-command-hint">
            <Kbd>esc</Kbd>
            close
          </span>
        </div>
      </CommandDialog>
    </>
  )
}

const AppSidebarMemo = React.memo(AppSidebar)

export { AppSidebarMemo as AppSidebar, type AppSidebarProps }
