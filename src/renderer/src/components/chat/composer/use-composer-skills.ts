import type { ChatSkillInvocationPart, SkillCatalog } from '@shared/ai/skills'
import * as React from 'react'

type CatalogState = {
  projectId: string | undefined
  revision: number
  status: 'loading' | 'ready' | 'error'
  catalog?: SkillCatalog
  error?: string
}

function useComposerSkills(projectId: string | null | undefined, draft: string) {
  const requestedProjectId = projectId ?? undefined
  const [state, setState] = React.useState<CatalogState>({
    projectId: requestedProjectId,
    revision: 0,
    status: 'loading'
  })
  const [revision, setRevision] = React.useState(0)
  const [dismissedDraft, setDismissedDraft] = React.useState<string | null>(null)
  const [selection, setSelection] = React.useState({ draft: '', index: 0 })

  React.useEffect(() => {
    let isCurrent = true
    if (!requestedProjectId) return
    void window.api.chat.getSkillCatalog({ projectId: requestedProjectId }).then(
      (catalog) => {
        if (isCurrent)
          setState({ projectId: requestedProjectId, revision, status: 'ready', catalog })
      },
      (cause: unknown) => {
        if (!isCurrent) return
        const detail = cause instanceof Error ? ` ${cause.message}` : ''
        setState({
          projectId: requestedProjectId,
          revision,
          status: 'error',
          error: `Could not load skills.${detail} Retry to choose a skill. Your draft is kept.`
        })
      }
    )
    return () => {
      isCurrent = false
    }
  }, [requestedProjectId, revision])

  const status = !requestedProjectId
    ? 'ready'
    : state.projectId === requestedProjectId && state.revision === revision
      ? state.status
      : 'loading'
  const catalog = requestedProjectId && status === 'ready' ? state.catalog : undefined
  const query = /^\/(?:skill:)?([^\s]*)$/.exec(draft)?.[1]
  const isOpen = query !== undefined && dismissedDraft !== draft
  const skills = (catalog?.skills ?? []).filter((skill) => skill.userInvocable)
  const matches = skills.filter((skill) => skill.name.includes(query ?? ''))
  const selectedIndex =
    selection.draft === draft ? Math.min(selection.index, Math.max(0, matches.length - 1)) : 0

  const resolveInvocation = (): ChatSkillInvocationPart['data'] | undefined => {
    if (!draft.startsWith('/skill:')) return undefined
    if (status !== 'ready')
      throw new Error('Skills are unavailable. Retry loading skills before sending this command.')
    const command = /^\/skill:([^\s]+)(?:\s([\s\S]*))?$/.exec(draft)
    const skill = skills.find(({ name }) => name === command?.[1])
    if (!skill)
      throw new Error(
        `Unknown skill "${command?.[1] ?? ''}". Choose an available skill or remove the command.`
      )
    return { skillId: skill.id, name: skill.name, arguments: command?.[2] ?? '' }
  }

  return {
    isOpen,
    status,
    error: status === 'error' ? state.error : undefined,
    diagnostics: catalog?.diagnostics ?? [],
    matches,
    selectedIndex,
    selectIndex: (index: number): void => {
      setSelection({ draft, index })
    },
    moveSelection: (direction: number): void => {
      if (matches.length)
        setSelection({
          draft,
          index: (selectedIndex + direction + matches.length) % matches.length
        })
    },
    dismiss: (): void => setDismissedDraft(draft),
    resetDismissal: (): void => setDismissedDraft(null),
    retry: (): void => setRevision((current) => current + 1),
    resolveInvocation
  }
}

export { useComposerSkills }
