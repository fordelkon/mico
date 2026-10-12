import {
  ChatSkillInvocationPartSchema,
  type ChatSkillInvocationPart,
  type SkillCatalog
} from '@shared/ai/skills'
import * as React from 'react'
import { COMPACT_COMMAND } from './composer-commands'

type CatalogState = {
  projectId: string | undefined
  revision: number
  status: 'loading' | 'ready' | 'error'
  catalog?: SkillCatalog
  error?: string
}

type ComposerCommandItem = {
  kind: 'command'
  id: string
  name: string
  token: string
  label: string
  description: string
}

type ComposerSkillItem = {
  kind: 'skill'
  id: string
  name: string
  description: string
}

type ComposerMenuItem = ComposerCommandItem | ComposerSkillItem

type ComposerCompletion = {
  text: string
  /** Caret after completing: right behind the token and its separating space. */
  caret: number
  /** End of the draft range the completion transaction replaces. */
  replacedEnd: number
}

/** Everything after the leading invocation token; empty when there is none. */
function commandArguments(draft: string): string {
  return /^\$[^\s]*(?:\s([\s\S]*))?$/.exec(draft)?.[1] ?? ''
}

/**
 * How the menu was opened: a leading `/` query offers the built-in commands, a
 * leading `$` query offers skills only, and `null` means the menu is closed.
 */
type ComposerQueryMode = 'slash' | 'dollar' | null

function useComposerSkills(
  projectId: string | null | undefined,
  draft: string,
  { offerCompactCommand, caret }: { offerCompactCommand: boolean; caret: number }
) {
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
  // Only the leading token can be an invocation. Editing that token opens the
  // menu without replacing its following arguments or treating inline $ as a
  // second invocation. A leading `/skill:` prefix is plain text: it opens no
  // menu and never invokes a skill.
  const leadingToken = /^([/$][^\s]*)/.exec(draft)?.[1]
  const slashQuery =
    leadingToken && !leadingToken.startsWith('/skill:')
      ? /^\/([^\s]*)$/.exec(leadingToken)?.[1]
      : undefined
  const dollarQuery = leadingToken ? /^\$([^\s]*)$/.exec(leadingToken)?.[1] : undefined
  const queryMode: ComposerQueryMode =
    slashQuery !== undefined ? 'slash' : dollarQuery !== undefined ? 'dollar' : null
  const query = slashQuery ?? dollarQuery ?? ''
  const tokenEnd = leadingToken?.length ?? 0
  const isOpen = queryMode !== null && caret <= tokenEnd && dismissedDraft !== draft
  // Built-in commands are independent of the skill catalog: they stay available
  // while skills load, fail, or need a workspace, and only the slash menu
  // offers them — a `$` query selects skills alone.
  const normalizedQuery = query.toLocaleLowerCase()
  // Matching ignores case and ranks prefix matches first so "$comp" offers
  // "compact"-like names before loose substring hits.
  const matchesQuery = (name: string): boolean => name.toLocaleLowerCase().includes(normalizedQuery)
  const commandMatches =
    queryMode === 'slash' && offerCompactCommand
      ? matchesQuery(COMPACT_COMMAND.name)
        ? [COMPACT_COMMAND]
        : []
      : []
  const skills = (catalog?.skills ?? []).filter((skill) => skill.userInvocable)
  const skillMatches =
    queryMode === 'dollar' ? skills.filter((skill) => matchesQuery(skill.name)) : []
  skillMatches.sort((left, right) => {
    const leftPrefix = left.name.toLocaleLowerCase().startsWith(normalizedQuery) ? 0 : 1
    const rightPrefix = right.name.toLocaleLowerCase().startsWith(normalizedQuery) ? 0 : 1
    return leftPrefix - rightPrefix
  })
  const matches: ComposerMenuItem[] = [
    ...commandMatches,
    ...skillMatches.map((skill): ComposerSkillItem => ({ ...skill, kind: 'skill' }))
  ]
  const selectedIndex =
    selection.draft === draft ? Math.min(selection.index, Math.max(0, matches.length - 1)) : 0

  const knownSkillNames = new Set(skills.map(({ name }) => name))

  // Completing an entry rewrites only the leading token; the arguments after
  // it stay untouched. The trailing space separates the token from its
  // arguments, and the caret lands right after it.
  const applyCompletion = (item: ComposerMenuItem): ComposerCompletion => {
    // Skill entries always complete to `$name`; the slash menu offers commands
    // only, so no slash skill token exists.
    const token = item.kind === 'command' ? COMPACT_COMMAND.token : `$${item.name}`
    const existingSuffix = draft.slice(tokenEnd)
    return {
      text: `${token}${existingSuffix[0] || ' '}`,
      caret: token.length + 1,
      replacedEnd: tokenEnd + (existingSuffix ? 1 : 0)
    }
  }

  const resolveInvocation = (text = draft): ChatSkillInvocationPart['data'] | undefined => {
    // A leading `$name` invokes a skill only when the name exactly matches an
    // invocable one; once the catalog is ready, unknown names stay ordinary
    // text. Until then, a leading $name is ambiguous and requires a retry.
    // Inline references, a bare $, and any leading / token (including the
    // historic `/skill:` form) remain ordinary text.
    const dollarReference = /^\$([^\s]+)(?:\s([\s\S]*))?$/.exec(text)
    if (!dollarReference) return undefined
    if (status !== 'ready')
      throw new Error(
        'Skills are unavailable. Retry loading skills before sending this invocation.'
      )
    const skill = skills.find(({ name: candidate }) => candidate === dollarReference[1])
    if (!skill) return undefined
    const invocation = { skillId: skill.id, name: skill.name, arguments: commandArguments(text) }
    const validated = ChatSkillInvocationPartSchema.safeParse({
      type: 'data-skill-invocation',
      data: invocation
    })
    if (!validated.success)
      throw new Error('Skill arguments exceed the 64 KiB limit. Shorten them before sending.')
    return validated.data.data
  }

  return {
    isOpen,
    // The composer styles each open menu by its query mode; the catalog-driven
    // fields below stay invisible to the slash menu, which offers commands
    // alone and never depends on the skill catalog.
    queryMode,
    status: queryMode === 'dollar' ? status : 'ready',
    error: queryMode === 'dollar' && status === 'error' ? state.error : undefined,
    diagnostics: queryMode === 'dollar' ? (catalog?.diagnostics ?? []) : [],
    matches,
    // Exact invocable names for draft highlighting; empty while loading or on
    // error so unresolved words simply stay plain text.
    knownSkillNames,
    selectedIndex,
    applyCompletion,
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
