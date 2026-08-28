import { Separator, SidebarInset, SidebarProvider } from '@mico/ui'

import { ChatMain } from './components/chat/chat-main'
import { AppSidebar } from './components/sidebar/app-sidebar'
import { WindowControls } from './components/window-controls/window-controls'
import { useChatWorkspaceState } from './hooks/chat/use-chat-workspace-state'
import { selectConversationWithPaperTransition } from '@renderer/utils/conversation-paper-transition'

function App(): React.JSX.Element {
  const workspace = useChatWorkspaceState()

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
        onDeleteConversation={workspace.deleteConversation}
        onNewChat={workspace.startNewChat}
        onRenameConversation={workspace.renameConversation}
        onSelectConversation={handleSelectConversation}
      />
      <WindowControls />
      <div aria-hidden="true" className="home-workspace__paper-feed">
        <Separator className="home-workspace__paper-slot" />
      </div>
      <SidebarInset aria-label="Main content" className="home-workspace__content">
        <ChatMain workspace={workspace} />
      </SidebarInset>
    </SidebarProvider>
  )
}

export default App
