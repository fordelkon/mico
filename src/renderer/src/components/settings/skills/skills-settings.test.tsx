import type { SkillCatalog } from '@shared/ai/skills'
import type { SkillsAPI } from '@shared/ipc/schemas/skills'
import type { WorkspacesAPI } from '@shared/ipc/schemas/workspaces'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillsSettings } from './skills-settings'

const projects = [
  { id: 'default', name: 'Default', rootPath: '/workspaces/default', isDefault: true },
  { id: 'active', name: 'Active project', rootPath: '/projects/active', isDefault: false }
]
const catalog: SkillCatalog = {
  skills: [
    {
      id: 'project-agents:review',
      name: 'review',
      description: 'Review project changes',
      source: 'project-agents',
      userInvocable: false,
      disableModelInvocation: false
    }
  ],
  diagnostics: []
}
const skillsApi = {
  list: vi.fn<SkillsAPI['list']>(),
  readDocument: vi.fn<SkillsAPI['readDocument']>()
}

const listProjects = vi.fn<WorkspacesAPI['list']>()

beforeEach(() => {
  listProjects.mockReset().mockResolvedValue(projects)
  skillsApi.list
    .mockReset()
    .mockImplementation(async ({ projectId }) =>
      projectId === 'active' ? catalog : { skills: [], diagnostics: [] }
    )
  skillsApi.readDocument.mockReset().mockResolvedValue({
    content: '---\nname: review\n---\n# Review instructions',
    body: '# Review instructions'
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { skills: skillsApi, workspaces: { list: listProjects } }
  })
})

describe('SkillsSettings', () => {
  it('user refreshes when the active workspace was removed, then the default catalog appears', async () => {
    const user = userEvent.setup()
    listProjects
      .mockResolvedValueOnce(projects)
      .mockResolvedValueOnce([{ ...projects[0], name: 'Renamed workspace' }])
    render(<SkillsSettings initialProjectId="active" />)
    await screen.findByRole('button', { name: 'View review' })
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('No skills found in this workspace.')).toBeVisible()
  })

  it('user opens settings when the active workspace is pending, then it becomes the initial selection', async () => {
    const { rerender } = render(<SkillsSettings />)
    await screen.findByText('No skills found in this workspace.')
    rerender(<SkillsSettings initialProjectId="active" />)
    expect(await screen.findByRole('button', { name: 'View review' })).toBeVisible()
    expect(screen.queryByRole('combobox', { name: 'Workspace' })).not.toBeInTheDocument()
  })
  it('user opens a skill when browsing the active workspace, then can read preview and source', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<SkillsSettings initialProjectId="active" />)
    await user.click(await screen.findByRole('button', { name: 'View review' }))
    const dialog = await screen.findByRole('dialog', { name: 'review' })
    expect(dialog).toHaveAccessibleDescription('Review project changes')
    expect(
      await within(dialog).findByRole('heading', { name: 'Review instructions' })
    ).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Code' }))
    expect(within(dialog).getByLabelText('SKILL.md source')).toHaveTextContent('name: review')
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }))
    expect(within(dialog).getByRole('heading', { name: 'Review instructions' })).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: /^Close$/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Search skills' }), 'missing')
    expect(screen.getByText('No matching skills.')).toBeVisible()
    await user.clear(screen.getByRole('textbox', { name: 'Search skills' }))
    rerender(<SkillsSettings initialProjectId="default" />)
    expect(await screen.findByText('No skills found in this workspace.')).toBeVisible()
  })

  it.each(['Escape', 'Close'])(
    'user dismisses with %s when viewing a filtered skill, then retains focus and search',
    async (dismissal) => {
      const user = userEvent.setup()
      render(<SkillsSettings initialProjectId="active" />)
      const row = await screen.findByRole('button', { name: 'View review' })
      const search = screen.getByRole('textbox', { name: 'Search skills' })
      await user.type(search, 'review')
      await user.click(row)
      const dialog = await screen.findByRole('dialog', { name: 'review' })
      expect(row).toBeInTheDocument()
      if (dismissal === 'Escape') {
        await user.keyboard('{Escape}')
      } else {
        await user.click(within(dialog).getByRole('button', { name: /^Close$/ }))
      }
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(row).toHaveFocus()
      expect(search).toHaveValue('review')
      expect(screen.getByRole('button', { name: 'View review' })).toBe(row)
    }
  )

  it('user changes workspace when an older request is pending, then only the new catalog appears', async () => {
    let resolveOld: (value: SkillCatalog) => void = () => undefined
    skillsApi.list.mockImplementation(({ projectId }) =>
      projectId === 'active'
        ? new Promise((resolve) => {
            resolveOld = resolve
          })
        : Promise.resolve({ skills: [], diagnostics: [] })
    )
    const { rerender } = render(<SkillsSettings initialProjectId="active" />)
    await screen.findByLabelText('Loading skills')
    rerender(<SkillsSettings initialProjectId="default" />)
    expect(await screen.findByText('No skills found in this workspace.')).toBeVisible()
    await act(async () => resolveOld(catalog))
    expect(screen.queryByRole('button', { name: 'View review' })).not.toBeInTheDocument()
  })

  it('user retries when reading a skill fails, then the document becomes readable', async () => {
    const user = userEvent.setup()
    skillsApi.readDocument.mockRejectedValueOnce(new Error('Skill moved'))
    render(<SkillsSettings initialProjectId="active" />)
    await user.click(await screen.findByRole('button', { name: 'View review' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Skill moved')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Review instructions' })).toBeVisible()
  })
})
