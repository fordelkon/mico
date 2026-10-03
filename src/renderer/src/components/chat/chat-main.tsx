import { Spinner } from '@mico/ui'
import type { ChatWorkspace } from '@renderer/hooks/chat/use-chat-workspace-state'
import { isActiveChatResponse } from '@renderer/types/chat'
import type { ModelReasoningCapabilities } from '@shared/data/schemas/chat'
import * as React from 'react'

import { ChatComposer, type ChatComposerMode } from './composer/chat-composer'
import { EmptyConversation } from './empty-conversation'
import './chat-main.css'

const SubscribedChatMessageList = React.lazy(async () => {
  const module = await import('./conversation/chat-message-list')
  return { default: module.SubscribedChatMessageList }
})

type ChatMainProps = {
  workspace: ChatWorkspace
}

function ChatMain({ workspace }: ChatMainProps): React.JSX.Element {
  const [refreshedCapabilities, setRefreshedCapabilities] = React.useState<
    ModelReasoningCapabilities | null | undefined
  >(undefined)
  const { setThinkingEffort } = workspace

  const refreshCapabilities = React.useCallback(async (): Promise<void> => {
    const capabilities = await window.api.chat.getCapabilities()
    setRefreshedCapabilities(capabilities ?? null)
    if (!capabilities) setThinkingEffort('none')
  }, [setThinkingEffort])

  const { response } = workspace
  const isForActiveConversation =
    response.status !== 'idle' && workspace.activeConversation?.id === response.conversationId
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
      permissionMode={workspace.permissionMode}
      onPermissionModeChange={workspace.setPermissionMode}
      canAddProject={!workspace.activeConversation}
      focusKey={workspace.composerFocusKey}
      mode={composerMode}
      onAddProject={workspace.addProjectToNewChat}
      onProjectSelected={workspace.selectProjectForNewChat}
      onProjectsRefresh={workspace.refreshProjects}
      projectId={workspace.activeProject?.id ?? null}
      onModelSelected={refreshCapabilities}
      selectedModelEntryId={
        workspace.activeConversation ? workspace.selectedModelEntryId : undefined
      }
      selectSessionModel={workspace.activeConversation ? workspace.setSessionModelEntry : undefined}
      onSend={workspace.sendMessage}
      onStop={workspace.stopResponse}
      projectLabel={workspace.activeProject?.name ?? null}
      projectPath={workspace.activeProject?.rootPath ?? null}
      projects={workspace.projects}
      reasoningCapabilities={
        refreshedCapabilities === undefined
          ? workspace.reasoningCapabilities
          : refreshedCapabilities
      }
      thinkingEffort={workspace.thinkingEffort}
      onThinkingEffortChange={workspace.setThinkingEffort}
    />
  )

  return (
    <div className="chat-paper paper-canvas flex min-h-0 flex-1 flex-col overflow-hidden">
      {workspace.activeConversation ? (
        <>
          <div
            className="chat-paper__conversation flex min-h-0 flex-1"
            key={workspace.activeConversation.id}
          >
            {workspace.activeChat && (
              <React.Suspense
                fallback={
                  <div className="flex min-h-0 flex-1 items-center justify-center">
                    <Spinner className="size-5 text-text-tertiary" />
                  </div>
                }
              >
                <SubscribedChatMessageList
                  chat={workspace.activeChat}
                  conversationId={workspace.activeConversation.id}
                  errorMessage={errorMessage}
                  isResponding={isActiveResponse}
                  isThinkingEnabled={workspace.thinkingEffort !== 'none'}
                  onRetry={errorMessage ? workspace.retryResponse : undefined}
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
