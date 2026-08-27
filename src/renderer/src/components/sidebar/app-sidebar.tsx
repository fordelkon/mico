import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  IconTooltipButton,
  Kbd,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarResizeHandle,
  useSidebar
} from '@mico/ui'
import type { Conversation } from '@renderer/lib/ai/chat-types'
import { Moon, PanelLeft, Search, SquarePen } from 'lucide-react'
import * as React from 'react'

import { useAppearance } from '../appearance-provider'
import { ConversationRow } from './conversation-row'
import './app-sidebar.css'

type AppSidebarProps = {
  conversations: Conversation[]
  activeConversationId: string | null
  onDeleteConversation: (conversationId: string) => void
  onNewChat: () => void
  onRenameConversation: (conversationId: string, title: string) => void
  onSelectConversation: (conversationId: string, options?: { focusComposer?: boolean }) => void
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
  onDeleteConversation,
  onNewChat,
  onRenameConversation,
  onSelectConversation
}: AppSidebarProps): React.JSX.Element {
  const { state, toggleSidebar } = useSidebar()
  const { preference, setPreference } = useAppearance()
  const collapsed = state === 'collapsed'
  const [searchOpen, setSearchOpen] = React.useState(false)

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
        className="app-sidebar font-display"
        collapsible="offcanvas"
        variant="floating"
      >
        <SidebarContent className="pt-[60px]">
          <SidebarGroup>
            {conversations.length > 0 ? (
              <SidebarMenu>
                {conversations.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    selected={conversation.id === activeConversationId}
                    onDelete={() => onDeleteConversation(conversation.id)}
                    onRename={(title) => onRenameConversation(conversation.id, title)}
                    onSelect={(options) => onSelectConversation(conversation.id, options)}
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
          icon={<SquarePen aria-hidden="true" />}
          label="New chat"
          onClick={onNewChat}
          tooltip={
            <>
              <span>New chat</span>
              <Kbd>⌘ N</Kbd>
            </>
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

export { AppSidebar, type AppSidebarProps }
