import {
  IconTooltipButton,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarResizeHandle,
  useSidebar
} from '@mico/ui'
import type { Conversation } from '@renderer/lib/ai/chat-types'
import { PanelLeft, Search, SquarePen } from 'lucide-react'

import { ConversationRow } from './conversation-row'
import './app-sidebar.css'

type AppSidebarProps = {
  conversations: Conversation[]
  activeConversationId: string | null
  onDeleteConversation: (conversationId: string) => void
  onNewChat: () => void
  onRenameConversation: (conversationId: string, title: string) => void
  onSelectConversation: (conversationId: string) => void
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
  const collapsed = state === 'collapsed'

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
                    onSelect={() => onSelectConversation(conversation.id)}
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
        />
        <IconTooltipButton
          className="titlebar-button"
          icon={<SquarePen aria-hidden="true" />}
          label="New chat"
          onClick={onNewChat}
        />
      </header>
    </>
  )
}

export { AppSidebar, type AppSidebarProps }
