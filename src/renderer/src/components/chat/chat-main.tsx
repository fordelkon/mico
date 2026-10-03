import { Spinner } from '@mico/ui'
import type { ChatActiveSessionSlice } from '@renderer/hooks/chat/use-active-session'
import type { ChatResponseSlice } from '@renderer/hooks/chat/use-chat-workspace-state'
import { isActiveChatResponse } from '@renderer/types/chat'
import * as React from 'react'

import { ChatComposer, type ChatComposerMode } from './composer/chat-composer'
import { EmptyConversation } from './empty-conversation'
import './chat-main.css'

const SubscribedChatMessageList = React.lazy(async () => {
  const module = await import('./conversation/chat-message-list')
  return { default: module.SubscribedChatMessageList }
})

type ChatMainProps = {
  session: ChatActiveSessionSlice
  responses: ChatResponseSlice
}

function ChatMain({ session, responses }: ChatMainProps): React.JSX.Element {
  const { response } = responses
  const isForActiveConversation =
    response.status !== 'idle' && session.activeConversation?.id === response.conversationId
  const isActiveResponse = isActiveChatResponse(response) && isForActiveConversation
  const composerMode: ChatComposerMode = !isActiveChatResponse(response)
    ? 'send'
    : isActiveResponse
      ? 'stop'
      : 'disabled'
  const errorMessage =
    response.status === 'error' && isForActiveConversation ? response.message : undefined
  const retry = response.status === 'retrying' && isForActiveConversation ? response : undefined
  const composer = (
    <ChatComposer
      permissionMode={session.permissionMode}
      onPermissionModeChange={session.setPermissionMode}
      canAddProject={!session.activeConversation}
      focusKey={session.composerFocusKey}
      mode={composerMode}
      onAddProject={session.addProjectToNewChat}
      onProjectSelected={session.selectProjectForNewChat}
      onProjectsRefresh={session.refreshProjects}
      projectId={session.activeProject?.id ?? null}
      onModelSelected={session.refreshCapabilities}
      selectedModelEntryId={session.activeConversation ? session.selectedModelEntryId : undefined}
      selectSessionModel={session.activeConversation ? session.setSessionModelEntry : undefined}
      onSend={responses.sendMessage}
      onStop={responses.stopResponse}
      projectLabel={session.activeProject?.name ?? null}
      projectPath={session.activeProject?.rootPath ?? null}
      projects={session.projects}
      reasoningCapabilities={session.reasoningCapabilities}
      thinkingEffort={session.thinkingEffort}
      onThinkingEffortChange={session.setThinkingEffort}
    />
  )

  return (
    <div className="chat-paper paper-canvas flex min-h-0 flex-1 flex-col overflow-hidden">
      {session.activationError && <p role="alert">{session.activationError}</p>}
      {session.activeConversation ? (
        <>
          <div
            className="chat-paper__conversation flex min-h-0 flex-1"
            key={session.activeConversation.id}
          >
            {session.activeChat && (
              <React.Suspense
                fallback={
                  <div className="flex min-h-0 flex-1 items-center justify-center">
                    <Spinner className="size-5 text-text-tertiary" />
                  </div>
                }
              >
                <SubscribedChatMessageList
                  chat={session.activeChat}
                  conversationId={session.activeConversation.id}
                  errorMessage={errorMessage}
                  isResponding={isActiveResponse}
                  isThinkingEnabled={session.thinkingEffort !== 'none'}
                  onRetry={errorMessage ? responses.retryResponse : undefined}
                  retry={retry}
                />
              </React.Suspense>
            )}
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
