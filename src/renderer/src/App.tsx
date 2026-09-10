import { Separator, SidebarInset, SidebarProvider } from '@mico/ui'
import * as React from 'react'

import { ChatMain } from './components/chat/chat-main'
import { SettingsMain } from './components/settings/settings-main'
import { ProviderLibraryProvider } from './components/settings/providers/provider-library'
import { useProviderLibrary } from './components/settings/providers/provider-library'
import { AppSidebar } from './components/sidebar/app-sidebar'
import { WindowControls } from './components/window-controls/window-controls'
import { useChatWorkspaceState } from './hooks/chat/use-chat-workspace-state'
import { selectConversationWithPaperTransition } from '@renderer/utils/conversation-paper-transition'
import { transitionSettingsPage } from '@renderer/utils/settings-paper-transition'

function AppContent(): React.JSX.Element {
  const workspace = useChatWorkspaceState()
  const { flushLibrary } = useProviderLibrary()
  const [activePage, setActivePage] = React.useState<'chat' | 'settings'>('chat')
  const [settingsPage, setSettingsPage] = React.useState<'providers' | 'appearance'>('providers')

  const handleNewChat = (): void => {
    setActivePage('chat')
    workspace.startNewChat()
  }

  const handleOpenSettings = React.useCallback((): void => {
    if (activePage === 'settings') return

    transitionSettingsPage(() => setActivePage('settings'))
  }, [activePage])

  const handleBackFromSettings = React.useCallback(async (): Promise<void> => {
    // The outgoing settings view remains visible until its draft reaches the snapshot boundary.
    await flushLibrary()
    transitionSettingsPage(() => setActivePage('chat'))
  }, [flushLibrary])

  const handleSelectSettingsPage = React.useCallback(
    (page: 'providers' | 'appearance'): void => {
      if (page === settingsPage) return

      transitionSettingsPage(() => setSettingsPage(page))
    },
    [settingsPage]
  )

  // Keep every sidebar selection on the same conversation handoff path.
  const handleSelectConversation = (
    conversationId: string,
    options?: { focusComposer?: boolean }
  ): void => {
    selectConversationWithPaperTransition({
      activeConversationId: workspace.activeConversation?.id ?? null,
      conversationId,
      options,
      selectConversation: workspace.selectConversation
    })
  }

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
          <SettingsMain page={settingsPage} />
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
