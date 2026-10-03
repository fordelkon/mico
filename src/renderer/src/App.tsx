import { Separator, SidebarInset, SidebarProvider, Spinner } from '@mico/ui'
import * as React from 'react'

import { ChatMain } from './components/chat/chat-main'
import {
  ProviderLibraryProvider,
  useProviderLibraryActions
} from './components/settings/providers/provider-library'
import { AppSidebar } from './components/sidebar/app-sidebar'
import { WindowControls } from './components/window-controls/window-controls'
import { useChatWorkspaceState } from './hooks/chat/use-chat-workspace-state'
import { selectConversationWithPaperTransition } from '@renderer/utils/conversation-paper-transition'
import { transitionSettingsPage } from '@renderer/utils/settings-paper-transition'

const SettingsMain = React.lazy(() => import('./components/settings/settings-main'))

function AppContent(): React.JSX.Element {
  const workspace = useChatWorkspaceState()
  const { commitProviderDrafts } = useProviderLibraryActions()
  const [activePage, setActivePage] = React.useState<'chat' | 'settings'>('chat')
  const [settingsPage, setSettingsPage] = React.useState<'providers' | 'appearance' | 'workspaces'>(
    'providers'
  )

  const { startNewChat, selectConversation, activeConversation, refreshProjects } = workspace
  const handleOpenSettings = React.useCallback((): void => {
    if (activePage === 'settings') return

    transitionSettingsPage(() => setActivePage('settings'))
  }, [activePage])

  const leaveSettings = React.useCallback(
    async (changePage: () => void): Promise<void> => {
      // Every settings exit observes the same draft and workspace snapshot boundary.
      await commitProviderDrafts()
      await refreshProjects().catch(() => undefined)
      transitionSettingsPage(changePage)
    },
    [commitProviderDrafts, refreshProjects]
  )

  const handleBackFromSettings = React.useCallback(
    (): Promise<void> => leaveSettings(() => setActivePage('chat')),
    [leaveSettings]
  )

  const handleNewChat = React.useCallback((): void => {
    const start = (): void => {
      setActivePage('chat')
      startNewChat()
    }
    if (activePage === 'settings') void leaveSettings(start)
    else start()
  }, [activePage, leaveSettings, startNewChat])

  const handleSelectSettingsPage = React.useCallback(
    (page: 'providers' | 'appearance' | 'workspaces'): void => {
      if (page === settingsPage) return

      transitionSettingsPage(() => setSettingsPage(page))
    },
    [settingsPage]
  )

  // Keep every sidebar selection on the same conversation handoff path.
  const activeConversationId = activeConversation?.id ?? null
  const handleSelectConversation = React.useCallback(
    (conversationId: string, options?: { focusComposer?: boolean }): void => {
      if (activePage === 'settings') {
        void leaveSettings(() => {
          setActivePage('chat')
          selectConversation(conversationId, options)
        })
        return
      }
      selectConversationWithPaperTransition({
        activeConversationId,
        conversationId,
        options,
        selectConversation
      })
    },
    [activeConversationId, activePage, leaveSettings, selectConversation]
  )

  return (
    <SidebarProvider
      className="home-workspace"
      data-platform={window.electron.process.platform}
      resize={{ defaultWidth: 240, maxWidth: 320, minWidth: 180 }}
    >
      <div aria-hidden="true" className="home-workspace__titlebar" />
      <AppSidebar
        activeConversationId={workspace.activeConversation?.id ?? null}
        conversations={workspace.conversations}
        projects={workspace.projects}
        respondingConversationIds={workspace.respondingConversationIds}
        onDeleteConversation={workspace.deleteConversation}
        onBackFromSettings={handleBackFromSettings}
        onNewChat={handleNewChat}
        onOpenSettings={handleOpenSettings}
        onRenameConversation={workspace.renameConversation}
        onSelectConversation={handleSelectConversation}
        onSelectSettingsPage={handleSelectSettingsPage}
        settingsPage={settingsPage}
        settingsActive={activePage === 'settings'}
      />
      <WindowControls />
      <div aria-hidden="true" className="home-workspace__paper-feed">
        <Separator className="home-workspace__paper-slot" />
      </div>
      <SidebarInset
        aria-label="Main content"
        className="home-workspace__content"
        data-page={activePage}
      >
        {activePage === 'settings' ? (
          <React.Suspense
            fallback={
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <Spinner className="size-5 text-text-tertiary" />
              </div>
            }
          >
            <SettingsMain page={settingsPage} />
          </React.Suspense>
        ) : (
          <ChatMain workspace={workspace} />
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}

function App(): React.JSX.Element {
  return (
    <ProviderLibraryProvider>
      <AppContent />
    </ProviderLibraryProvider>
  )
}

export default App
