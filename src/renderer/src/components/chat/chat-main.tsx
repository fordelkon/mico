import { Button, Spinner, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@mico/ui'
import type {
  ChatCompactionState,
  ChatCompactionsStore
} from '@renderer/hooks/chat/chat-session-instances'
import type { ChatActiveSessionSlice } from '@renderer/hooks/chat/use-active-session'
import type { ChatResponseSlice } from '@renderer/hooks/chat/use-chat-workspace-state'
import { isActiveChatResponse } from '@renderer/types/chat'
import { CheckIcon, CircleAlertIcon, CircleMinusIcon } from 'lucide-react'
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
  compactions: ChatCompactionsStore
}

/**
 * Conversation-local compaction feedback as one compact process row in the
 * reading column's rhythm. The spinner marks only a real in-flight request;
 * settled outcomes keep their own words instead of a spinner or a fake history
 * entry, and dismissal hides only this acknowledged outcome. Failed outcomes
 * stay actionable: retry reuses the existing compaction request owner.
 */
function ChatCompactionStatus({
  state,
  canRetry,
  onCancel,
  onDismiss,
  onRetry
}: {
  state: ChatCompactionState
  canRetry: boolean
  onCancel: () => void
  onDismiss: () => void
  onRetry: () => void
}): React.JSX.Element {
  if (state.status === 'failed')
    return (
      <div className="chat-process-row" data-tone="failed" role="alert">
        <span aria-hidden="true" className="chat-process-row__node">
          <CircleAlertIcon className="size-3.5" />
        </span>
        <p className="chat-process-row__label">{state.message}</p>
        <span className="chat-process-row__actions">
          <Button
            className="h-auto px-2 py-1 text-xs"
            disabled={!canRetry}
            size="sm"
            variant="ghost"
            onClick={onRetry}
          >
            Retry summary
          </Button>
          <Button
            className="h-auto px-2 py-1 text-xs"
            size="sm"
            variant="ghost"
            onClick={onDismiss}
          >
            Dismiss
          </Button>
        </span>
      </div>
    )

  if (state.status === 'pending')
    return (
      <>
        <div className="chat-process-row" data-live="true" role="status">
          <span aria-hidden="true" className="chat-process-row__node">
            <Spinner className="size-3.5" />
          </span>
          <p className="chat-process-row__label">Summarizing conversation…</p>
          <span className="chat-process-row__actions">
            <Button
              className="h-auto px-2 py-1 text-xs"
              size="sm"
              variant="ghost"
              onClick={onCancel}
            >
              Cancel summary
            </Button>
          </span>
        </div>
        {state.error && (
          <p className="chat-process-row__label text-destructive" role="alert">
            {state.error}
          </p>
        )}
      </>
    )

  return (
    <div className="chat-process-row" role="status">
      <span aria-hidden="true" className="chat-process-row__node">
        {state.status === 'accepted' ? (
          <CheckIcon className="size-3.5" />
        ) : (
          <CircleMinusIcon className="size-3.5" />
        )}
      </span>
      <p className="chat-process-row__label">
        {state.status === 'accepted'
          ? 'Context compacted.'
          : 'Summary cancelled. Your messages remain intact. Use /compact to try again.'}
      </p>
      <span className="chat-process-row__actions">
        <Button className="h-auto px-2 py-1 text-xs" size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </span>
    </div>
  )
}

function ChatMain({ session, responses, compactions }: ChatMainProps): React.JSX.Element {
  const { response } = responses
  // Hide only the acknowledged state object. A newly published outcome becomes
  // visible even when its message matches an earlier dismissed failure.
  const [dismissedCompactions, setDismissedCompactions] = React.useState<
    ReadonlyMap<string, ChatCompactionState>
  >(() => new Map())
  const isForActiveConversation =
    response.status !== 'idle' && session.activeConversation?.id === response.conversationId
  const isActiveResponse = isActiveChatResponse(response) && isForActiveConversation
  const conversationId = session.activeConversation?.id
  const compactionState = conversationId ? compactions.states.get(conversationId) : undefined
  const composerMode: ChatComposerMode =
    compactionState?.status === 'pending'
      ? 'disabled'
      : !isActiveChatResponse(response)
        ? 'send'
        : isActiveResponse && response.status !== 'settling'
          ? 'stop'
          : 'disabled'
  const compactionStatus =
    compactionState &&
    conversationId &&
    dismissedCompactions.get(conversationId) !== compactionState ? (
      <ChatCompactionStatus
        state={compactionState}
        canRetry={!isActiveResponse}
        onCancel={() => void compactions.cancelCompaction(conversationId)}
        onDismiss={() =>
          setDismissedCompactions((current) =>
            new Map(current).set(conversationId, compactionState)
          )
        }
        onRetry={() => void compactions.startCompaction(conversationId)}
      />
    ) : undefined
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
      draftConversationId={conversationId}
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
      onCompact={
        conversationId ? () => void compactions.startCompaction(conversationId) : undefined
      }
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
                  failureCode={
                    response.status === 'error' && isForActiveConversation
                      ? response.failureCode
                      : undefined
                  }
                  isResponding={isActiveResponse}
                  isThinkingEnabled={session.thinkingEffort !== 'none'}
                  onRetry={
                    errorMessage && response.status === 'error' && response.canRetry !== false
                      ? responses.retryResponse
                      : undefined
                  }
                  retry={retry}
                  status={compactionStatus}
                />
              </React.Suspense>
            )}
          </div>
          {responses.estimatedInputTokens !== undefined && (
            <div className="mx-auto w-full max-w-[50rem] px-4 text-xs text-text-tertiary sm:px-6">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      className="rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      Approximate input: {responses.estimatedInputTokens.toLocaleString()} tokens
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Approximate application-visible input only. Tokenizers and provider formatting
                    differ; hidden provider state is excluded. The model context limit is unknown.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
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
