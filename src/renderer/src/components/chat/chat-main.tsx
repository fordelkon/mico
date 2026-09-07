import type { ChatWorkspace } from '@renderer/hooks/chat/use-chat-workspace-state'
import type { ModelReasoningCapabilities } from '@shared/data/schemas/chat'
import type { ProviderLibrary } from '@shared/data/schemas/provider'
import * as React from 'react'

import { ChatComposer, type ChatComposerMode } from './chat-composer'
import { ChatMessageList } from './chat-message-list'
import { ChatModelSelector, getEligibleModels } from './chat-model-selector'
import { EmptyConversation } from './empty-conversation'
import './chat-main.css'

type ChatMainProps = {
  workspace: ChatWorkspace
}

function ChatMain({ workspace }: ChatMainProps): React.JSX.Element {
  const [library, setLibrary] = React.useState<ProviderLibrary | null>(null)
  const [selectionError, setSelectionError] = React.useState<string | null>(null)
  const [refreshedCapabilities, setRefreshedCapabilities] = React.useState<
    ModelReasoningCapabilities | null | undefined
  >(undefined)

  React.useEffect(() => {
    let active = true

    void window.api.providers.getLibrary().then(
      (nextLibrary) => {
        if (active) setLibrary(nextLibrary)
      },
      () => {
        if (active) setSelectionError('Could not load models. Open Settings and try again.')
      }
    )

    return () => {
      active = false
    }
  }, [])

  const refreshCapabilities = React.useCallback(async (): Promise<void> => {
    const capabilities = await window.api.chat.getCapabilities()
    setRefreshedCapabilities(capabilities ?? null)
  }, [])

  const selectModel = React.useCallback(
    async (modelId: string): Promise<void> => {
      try {
        await window.api.providers.selectModel(modelId)
        const nextLibrary = await window.api.providers.getLibrary()
        setLibrary(nextLibrary)
        setSelectionError(null)
        await refreshCapabilities()
      } catch {
        setSelectionError(
          'Could not select this model. Verify its provider settings and try again.'
        )
      }
    },
    [refreshCapabilities]
  )
  const hasSelectedModel = getEligibleModels(library).some(
    ({ id }) => id === library?.selectedModelId
  )
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
      hasSelectedModel={hasSelectedModel}
      mode={composerMode}
      modelSelector={
        <div className="flex flex-col gap-1">
          <ChatModelSelector library={library} onSelect={selectModel} />
          {selectionError ? (
            <p className="px-2 text-xs text-destructive">{selectionError}</p>
          ) : null}
        </div>
      }
      onSend={workspace.sendMessage}
      onStop={workspace.stopResponse}
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
