import { Spinner } from '@mico/ui'
import type { ChatActiveSessionSlice } from '@renderer/hooks/chat/use-active-session'
import type { ChatResponseSlice } from '@renderer/hooks/chat/use-chat-workspace-state'
import { isActiveChatResponse } from '@renderer/types/chat'
import * as React from 'react'
import { ChatApproval } from './composer/chat-approval'
import { ChatComposer, type ChatComposerMode } from './composer/chat-composer'
import { ProjectSelector } from './composer/project-selector'
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
    : isActiveResponse && response.status !== 'settling'
      ? 'stop'
      : 'disabled'
  const errorMessage =
    response.status === 'error' && isForActiveConversation ? response.message : undefined
  const retry = response.status === 'retrying' && isForActiveConversation ? response : undefined
  const composer = (
    <ChatComposer
      approval={
        session.activeConversation && session.activeChat ? (
          <ChatApproval
            key={session.activeConversation.id}
            chat={session.activeChat}
            isActive={isActiveResponse}
          />
        ) : undefined
      }
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
          {session.activeProject && (
            <header
              aria-label="Conversation workspace"
              className="shrink-0 px-4 py-2 sm:px-6"
              role="group"
            >
              <div className="mx-auto w-full max-w-[50rem]">
                <ProjectSelector
                  canAddProject={false}
                  projectId={session.activeProject.id}
                  projectLabel={session.activeProject.name}
                  projectPath={session.activeProject.rootPath}
                  projects={session.projects}
                />
              </div>
            </header>
          )}
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
                  onRetry={
                    errorMessage && response.status === 'error' && response.canRetry !== false
                      ? responses.retryResponse
                      : undefined
                  }
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
