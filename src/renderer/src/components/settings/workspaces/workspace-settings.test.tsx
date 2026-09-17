import '@testing-library/jest-dom/vitest'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
          addFromDialog: vi.fn(),
          archive: vi.fn().mockResolvedValue(undefined),
          list: vi
            .fn()
            .mockResolvedValueOnce(projects)
            .mockResolvedValueOnce(projectsWithProjectOneAsDefault),
          rename: vi.fn(),
          reveal: vi.fn(),
          setDefault: vi.fn().mockResolvedValue({ ...projects[0], isDefault: true })
        }
      }
    })
  })

  it('updates the selected workspace after changing the default', async () => {
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
