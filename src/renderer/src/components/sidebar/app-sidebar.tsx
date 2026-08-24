import { PanelLeft, Search, SquarePen } from 'lucide-react'

import {
  IconTooltipButton,
  Sidebar,
  SidebarContent,
  SidebarResizeHandle,
  useSidebar
} from '@mico/ui'

import './app-sidebar.css'

function AppSidebar(): React.JSX.Element {
  const { state, toggleSidebar } = useSidebar()
  const collapsed = state === 'collapsed'

  return (
    <>
      <Sidebar
        aria-label="Sidebar"
        className="app-sidebar"
        collapsible="offcanvas"
        variant="floating"
      >
        <SidebarContent className="app-sidebar__content">
          <span>Clear History</span>
          <span>New Chat</span>
        </SidebarContent>
        <SidebarResizeHandle className="app-sidebar__resize-handle" />
      </Sidebar>

      <header className="app-sidebar__toolbar titlebar-control-group">
        <IconTooltipButton
          aria-expanded={!collapsed}
          className="app-sidebar__icon-button titlebar-button"
          icon={<PanelLeft aria-hidden="true" className="app-sidebar__toggle-icon" />}
          label="Toggle sidebar"
          onClick={toggleSidebar}
          tooltip={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        />
        <IconTooltipButton
          className="app-sidebar__icon-button titlebar-button"
          icon={<Search aria-hidden="true" />}
          label="Search threads"
          tooltip="Search threads"
        />
        <IconTooltipButton
          className="app-sidebar__icon-button titlebar-button"
          icon={<SquarePen aria-hidden="true" />}
          label="New chat"
          tooltip="New chat"
        />
      </header>
    </>
  )
}

export { AppSidebar }
