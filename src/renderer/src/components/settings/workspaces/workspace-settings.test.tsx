import '@testing-library/jest-dom/vitest'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspacesAPI } from '@shared/ipc/schemas/workspaces'

import { WorkspaceSettings } from './workspace-settings'

const projects = [
  { id: 'project-1', name: 'Project one', rootPath: '/projects/one', isDefault: false },
  { id: 'default', name: 'Default', rootPath: '/workspaces/default', isDefault: true }
]
const projectsWithProjectOneAsDefault = [
  { id: 'project-1', name: 'Project one', rootPath: '/projects/one', isDefault: true },
  { id: 'default', name: 'Default', rootPath: '/workspaces/default', isDefault: false }
]

describe('WorkspaceSettings', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        workspaces: {
          addFromDialog: vi.fn<WorkspacesAPI['addFromDialog']>(),
          archive: vi.fn<WorkspacesAPI['archive']>().mockResolvedValue(undefined),
          list: vi
            .fn<WorkspacesAPI['list']>()
            .mockResolvedValueOnce(projects)
            .mockResolvedValueOnce(projectsWithProjectOneAsDefault),
          rename: vi.fn<WorkspacesAPI['rename']>(),
          reveal: vi.fn<WorkspacesAPI['reveal']>(),
          setDefault: vi
            .fn<WorkspacesAPI['setDefault']>()
            .mockResolvedValue({ ...projects[0], isDefault: true })
        }
      }
    })
  })

  it('user sees Project one become default when set, then only it cannot be archived', async () => {
    const user = userEvent.setup()
    render(<WorkspaceSettings />)

    await screen.findByText('/projects/one')
    await user.click(screen.getByRole('button', { name: 'Set Project one as default' }))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Project one is the default workspace' })
      ).toBeVisible()
    )
    expect(screen.getByRole('button', { name: 'Archive Project one' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Archive Default' })).toBeEnabled()
  })
})
