import '@testing-library/jest-dom/vitest'

import { SidebarProvider } from '@mico/ui'
import type { Conversation } from '@renderer/types/chat'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppSidebar, type AppSidebarProps } from './app-sidebar'

const sidebarProps = {
  activeConversationId: 'conversation-1',
  conversations: [
    { id: 'conversation-1', title: 'First conversation' },
    { id: 'conversation-2', title: 'Second conversation' }
  ],
  onBackFromSettings: vi.fn<() => void>(),
  onDeleteConversation: vi.fn<AppSidebarProps['onDeleteConversation']>(async () => {}),
  onNewChat: vi.fn<() => void>(),
  onOpenSettings: vi.fn<() => void>(),
  onRenameConversation: vi.fn<AppSidebarProps['onRenameConversation']>(async () => {}),
  onSelectConversation:
    vi.fn<(conversationId: string, options?: { focusComposer?: boolean }) => void>(),
  onSelectProject: vi.fn<AppSidebarProps['onSelectProject']>(),
  respondingConversationIds: new Set<string>(),
  settingsActive: false
}

let apiDescriptor: PropertyDescriptor | undefined

describe('AppSidebar', () => {
  beforeEach(() => {
    apiDescriptor = Object.getOwnPropertyDescriptor(window, 'api')
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { windowControls: { platform: 'darwin' } }
    })
  })

  afterEach(() => {
    if (apiDescriptor) Object.defineProperty(window, 'api', apiDescriptor)
    else Reflect.deleteProperty(window, 'api')
  })

  function renderSidebar(overrides: Partial<AppSidebarProps> = {}) {
    return render(
      <SidebarProvider>
        <AppSidebar {...sidebarProps} {...overrides} />
      </SidebarProvider>
    )
  }

  it('user collapses a project when another chat responds, then its status stays visible', async () => {
    const user = userEvent.setup()
    renderSidebar({
      projects: [{ id: 'mico', name: 'mico', rootPath: '/projects/mico', isDefault: true }],
      conversations: [{ id: 'conversation-1', title: 'First conversation', projectId: 'mico' }],
      respondingConversationIds: new Set(['conversation-1'])
    })

    await user.click(screen.getByRole('button', { name: 'Toggle mico conversations' }))

    expect(screen.queryByRole('button', { name: 'First conversation' })).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Generating response in mico' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Toggle mico conversations' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('user searches a collapsed project when selecting a result, then that conversation opens', async () => {
    const user = userEvent.setup()
    const onSelectConversation =
      vi.fn<(id: string, options?: { focusComposer?: boolean }) => void>()
    renderSidebar({
      activeConversationId: null,
      projects: [
        { id: 'university', name: 'University', rootPath: '/projects/university', isDefault: false }
      ],
      conversations: [{ id: 'research', title: 'Research outline', projectId: 'university' }],
      onSelectConversation
    })
    expect(screen.queryByRole('button', { name: 'Research outline' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Search threads' }))
    await user.type(screen.getByRole('combobox'), 'University')
    await user.keyboard('{Enter}')

    expect(onSelectConversation).toHaveBeenCalledWith('research')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('user selects a chat when its project is collapsed, then the active group is revealed', async () => {
    const user = userEvent.setup()
    const props: AppSidebarProps = {
      ...sidebarProps,
      projects: [{ id: 'mico', name: 'mico', rootPath: '/projects/mico', isDefault: true }],
      conversations: [
        { id: 'conversation-1', title: 'First conversation' },
        { id: 'conversation-2', title: 'Project conversation', projectId: 'mico' }
      ]
    }
    const { rerender } = renderSidebar(props)
    await user.click(screen.getByRole('button', { name: 'Toggle mico conversations' }))

    rerender(
      <SidebarProvider>
        <AppSidebar {...props} activeConversationId="conversation-2" />
      </SidebarProvider>
    )

    expect(screen.getByRole('button', { name: 'Project conversation' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Toggle mico conversations' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('user keeps history when a workspace is unavailable, then the chat remains accessible', async () => {
    const user = userEvent.setup()
    renderSidebar({
      activeConversationId: null,
      conversations: [
        { id: 'orphan', title: 'Saved project chat', projectId: 'deleted', cwd: '/projects/old' }
      ]
    })

    await user.click(
      screen.getByRole('button', { name: 'Toggle Unavailable workspace: old conversations' })
    )

    expect(screen.getByRole('button', { name: 'Saved project chat' })).toBeVisible()
  })

  it('user reselects the current chat when its project is collapsed, then the project reopens', async () => {
    const user = userEvent.setup()
    renderSidebar({
      projects: [{ id: 'mico', name: 'mico', rootPath: '/projects/mico', isDefault: true }],
      conversations: [{ id: 'conversation-1', title: 'First conversation', projectId: 'mico' }]
    })
    await user.click(screen.getByRole('button', { name: 'Toggle mico conversations' }))
    await user.click(screen.getByRole('button', { name: 'Search threads' }))
    await user.type(screen.getByRole('combobox'), 'First conversation')
    await user.keyboard('{Enter}')

    expect(screen.getByRole('button', { name: 'First conversation' })).toBeVisible()
  })

  it('user selects a project when browsing history, then its conversations stay revealed', async () => {
    const user = userEvent.setup()
    const project = { id: 'mico', name: 'mico', rootPath: '/projects/mico', isDefault: true }
    const onSelectProject = vi.fn<AppSidebarProps['onSelectProject']>()
    renderSidebar({
      activeConversationId: null,
      projects: [project],
      conversations: [{ id: 'conversation-1', title: 'First conversation', projectId: 'mico' }],
      onSelectProject
    })

    await user.click(screen.getByRole('button', { name: 'mico' }))

    expect(onSelectProject).toHaveBeenCalledWith(project)
    // Navigation must not collapse the group the user is still browsing.
    expect(screen.getByRole('button', { name: 'First conversation' })).toBeVisible()
  })

  it('user clicks an unavailable workspace when viewing history, then its conversations are revealed', async () => {
    const user = userEvent.setup()
    renderSidebar({
      activeConversationId: null,
      conversations: [
        { id: 'orphan', title: 'Saved project chat', projectId: 'deleted', cwd: '/projects/old' }
      ]
    })

    await user.click(screen.getByRole('button', { name: 'Unavailable workspace: old' }))

    expect(sidebarProps.onSelectProject).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Saved project chat' })).toBeVisible()
  })

  it('user sees command shortcuts when holding the meta key, then they hide on release', () => {
    renderSidebar()

    fireEvent.keyDown(window, { key: 'Meta', metaKey: true })

    expect(screen.getByText('⌘ 1')).toBeVisible()
    expect(screen.getByText('⌘ 2')).toBeVisible()
    expect(screen.queryAllByRole('button', { name: 'More actions' })).toHaveLength(0)

    fireEvent.keyUp(window, { key: 'Meta' })

    expect(screen.queryByText('⌘ 1')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'More actions' })).toHaveLength(2)
  })

  it('user selects a conversation when pressing its command shortcut, then it opens', () => {
    const onSelectConversation =
      vi.fn<(conversationId: string, options?: { focusComposer?: boolean }) => void>()
    renderSidebar({ onSelectConversation })

    fireEvent.keyDown(window, { key: '2', metaKey: true })

    expect(onSelectConversation).toHaveBeenCalledWith('conversation-2')
  })

  it('user receives a status change for another conversation when rows are stable, then unchanged titles are not read again', () => {
    let stableTitleReads = 0
    const stableConversation = {
      id: 'conversation-1',
      get title() {
        stableTitleReads += 1
        return 'Stable conversation'
      }
    } satisfies Conversation
    const conversations = [
      stableConversation,
      { id: 'conversation-2', title: 'Streaming conversation' }
    ]
    const props = { ...sidebarProps, conversations, respondingConversationIds: new Set<string>() }
    const { rerender } = render(
      <SidebarProvider>
        <AppSidebar {...props} />
      </SidebarProvider>
    )
    const readsAfterInitialRender = stableTitleReads

    rerender(
      <SidebarProvider>
        <AppSidebar {...props} respondingConversationIds={new Set(['conversation-2'])} />
      </SidebarProvider>
    )

    expect(stableTitleReads).toBe(readsAfterInitialRender)
  })
})
