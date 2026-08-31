import type { ChatWorkspace } from '@renderer/hooks/chat/use-chat-workspace-state'

import { ChatComposer, type ChatComposerMode } from './chat-composer'
import { ChatMessageList } from './chat-message-list'
import { EmptyConversation } from './empty-conversation'
import './chat-main.css'

type ChatMainProps = {
  workspace: ChatWorkspace
}

function ChatMain({ workspace }: ChatMainProps): React.JSX.Element {
  const isActiveResponse =
    (workspace.response.status === 'submitted' ||
      workspace.response.status === 'streaming' ||
      workspace.response.status === 'retrying') &&
    workspace.activeConversation?.id === workspace.response.conversationId
  const composerMode: ChatComposerMode =
    workspace.response.status === 'submitted' ||
    workspace.response.status === 'streaming' ||
    workspace.response.status === 'retrying'
      ? isActiveResponse
        ? 'stop'
        : 'disabled'
      : 'send'
  const errorMessage =
    workspace.response.status === 'error' &&
    workspace.activeConversation?.id === workspace.response.conversationId
      ? workspace.response.message
      : undefined
  const retry =
    workspace.response.status === 'retrying' &&
    workspace.activeConversation?.id === workspace.response.conversationId
      ? workspace.response
      : undefined
  const composer = (
    <ChatComposer
      focusKey={workspace.composerFocusKey}
      mode={composerMode}
      onSend={workspace.sendMessage}
      onStop={workspace.stopResponse}
    />
  )

  return (
    <div className="chat-paper flex min-h-0 flex-1 flex-col overflow-hidden">
      {workspace.activeConversation ? (
        <>
          <div
            className="chat-paper__conversation flex min-h-0 flex-1"
            key={workspace.activeConversation.id}
          >
            <ChatMessageList
              conversationId={workspace.activeConversation.id}
              errorMessage={errorMessage}
              isResponding={isActiveResponse}
              messages={workspace.activeMessages}
              onRetry={errorMessage ? workspace.retryResponse : undefined}
              retry={retry}
            />
          </div>
          {composer}
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-20">
          <EmptyConversation />
          <div className="w-full">{composer}</div>
        </div>
      )}
    </div>
  )
}

export { ChatMain }
