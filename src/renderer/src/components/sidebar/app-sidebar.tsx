import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  IconSwap,
  IconTooltipButton,
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
import { useGlidingHighlight } from '@renderer/hooks/use-gliding-highlight'
import type { Conversation } from '@renderer/types/chat'
import type { WorkspaceProject } from '@shared/data/schemas/workspace'
import {
  ArrowLeft,
  Bot,
  FolderOpen,
  Moon,
  Palette,
  PanelLeft,
  Search,
  Settings,
  SquarePen
} from 'lucide-react'
import * as React from 'react'
import { useAppearance } from '../appearance-provider'
import { ConversationNavigation } from './conversation-navigation'
import './app-sidebar.css'

type AppSidebarProps = {
  conversations: Conversation[]
  projects?: WorkspaceProject[]
  activeConversationId: string | null
  respondingConversationIds: ReadonlySet<string>
  onDeleteConversation: (conversationId: string) => Promise<void>
  onBackFromSettings: () => void
  onNewChat: () => void
  onOpenSettings: () => void
  onRenameConversation: (conversationId: string, title: string) => Promise<void>
  onSelectConversation: (conversationId: string, options?: { focusComposer?: boolean }) => void
  onSelectSettingsPage?: (page: 'providers' | 'appearance' | 'workspaces') => void
  settingsPage?: 'providers' | 'appearance' | 'workspaces'
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
  projects = [],
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
  const [commandKeyPressed, setCommandKeyPressed] = React.useState(false)
  const [selectionRequest, setSelectionRequest] = React.useState<{
    id: string
    key: number
  } | null>(null)
  const handleConversationSelection = React.useCallback(
    (id: string, options?: { focusComposer?: boolean }): void => {
      setSelectionRequest((previous) => ({ id, key: (previous?.key ?? 0) + 1 }))
      if (options) onSelectConversation(id, options)
      else onSelectConversation(id)
    },
    [onSelectConversation]
  )
  const settingsHighlight = useGlidingHighlight<HTMLLIElement>()

  // Keep the new-chat shortcut available while focus is inside any sidebar control.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const isMacOS = window.api.windowControls.platform === 'darwin'
      const modifierPressed = isMacOS ? event.metaKey : event.ctrlKey
      if (!modifierPressed || event.key.toLowerCase() !== 'n') return

      event.preventDefault()
      onNewChat()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onNewChat])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey) setCommandKeyPressed(true)

      if (!event.metaKey || !/^[1-9]$/.test(event.key)) return

      const conversation = conversations[Number(event.key) - 1]
      if (!conversation) return

      event.preventDefault()
      handleConversationSelection(conversation.id)
    }
    const handleKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Meta' || !event.metaKey) setCommandKeyPressed(false)
    }
    const handleWindowBlur = (): void => setCommandKeyPressed(false)

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [conversations, handleConversationSelection])

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
              <SidebarMenu
                aria-label="Settings"
                className="relative"
                onMouseLeave={settingsHighlight.clearHighlight}
              >
                <span
                  {...settingsHighlight.highlightProps}
                  className={`${settingsHighlight.highlightProps.className} inset-x-1.5 rounded-lg bg-sidebar-row-hover`}
                />
                <SidebarMenuItem
                  {...settingsHighlight.getItemProps(0)}
                  className="relative z-10 mx-1.5 my-px"
                >
                  <SidebarMenuButton
                    aria-current={settingsPage === 'providers' ? 'page' : undefined}
                    className="h-[34px] rounded-lg px-[10px] text-[13px] font-normal text-text-secondary transition-colors hover:bg-transparent hover:text-text-secondary data-[active=true]:bg-sidebar-row-active data-[active=true]:text-text-secondary"
                    isActive={settingsPage === 'providers'}
                    onClick={() => onSelectSettingsPage?.('providers')}
                    tooltip="Providers"
                  >
                    <Bot aria-hidden="true" />
                    <span>Providers</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem
                  {...settingsHighlight.getItemProps(1)}
                  className="relative z-10 mx-1.5 my-px"
                >
                  <SidebarMenuButton
                    aria-current={settingsPage === 'workspaces' ? 'page' : undefined}
                    className="h-[34px] rounded-lg px-[10px] text-[13px] font-normal text-text-secondary transition-colors hover:bg-transparent hover:text-text-secondary data-[active=true]:bg-sidebar-row-active data-[active=true]:text-text-secondary"
                    isActive={settingsPage === 'workspaces'}
                    onClick={() => onSelectSettingsPage?.('workspaces')}
                    tooltip="Workspaces"
                  >
                    <FolderOpen aria-hidden="true" />
                    <span>Workspaces</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem
                  {...settingsHighlight.getItemProps(2)}
                  className="relative z-10 mx-1.5 my-px"
                >
                  <SidebarMenuButton
                    aria-current={settingsPage === 'appearance' ? 'page' : undefined}
                    className="h-[34px] rounded-lg px-[10px] text-[13px] font-normal text-text-secondary transition-colors hover:bg-transparent hover:text-text-secondary data-[active=true]:bg-sidebar-row-active data-[active=true]:text-text-secondary"
                    isActive={settingsPage === 'appearance'}
                    onClick={() => onSelectSettingsPage?.('appearance')}
                    tooltip="Appearance"
                  >
                    <Palette aria-hidden="true" />
                    <span>Appearance</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            ) : (
              <ConversationNavigation
                conversations={conversations}
                projects={projects}
                activeConversationId={activeConversationId}
                respondingConversationIds={respondingConversationIds}
                commandKeyPressed={commandKeyPressed}
                selectionRequest={selectionRequest}
                onDeleteConversation={onDeleteConversation}
                onRenameConversation={onRenameConversation}
                onSelectConversation={handleConversationSelection}
              />
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
          tooltip="Search threads and actions"
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
          {searchOpen && conversations.length > 0 && (
            <CommandGroup heading="Conversations">
              {conversations.map((conversation) => {
                const project = projects.find(({ id }) => id === conversation.projectId)
                const projectLabel =
                  project?.name ?? (conversation.projectId ? 'Unavailable workspace' : 'Chats')
                return (
                  <CommandItem
                    key={conversation.id}
                    value={conversation.id}
                    keywords={[
                      conversation.title,
                      projectLabel,
                      project?.rootPath ?? conversation.cwd ?? ''
                    ]}
                    onSelect={() => {
                      setSearchOpen(false)
                      handleConversationSelection(conversation.id)
                    }}
                  >
                    <span className="min-w-0 truncate">{conversation.title}</span>
                    <span className="ml-auto max-w-32 truncate text-xs text-muted-foreground">
                      {projectLabel}
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )}
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
