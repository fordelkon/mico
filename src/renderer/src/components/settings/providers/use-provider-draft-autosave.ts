import * as React from 'react'

type ProviderDraftUpdater<D> = (current: D | null) => D
type ProviderDraftAutosave<D> = {
  draft: D | null
  /** Replace the accumulated draft and (re)start the debounce timer. */
  edit: (draft: D) => void
  /** Replace the accumulated draft from its current value, then (re)start the timer. */
  editWith: (updater: ProviderDraftUpdater<D>) => void
  /** Cancel the debounce timer, keeping the accumulated draft local. */
  cancel: () => void
  /** Cancel the debounce timer and persist the accumulated draft immediately. */
  flush: () => Promise<void>
  /** Persist explicit updates immediately without changing the accumulated draft. */
  flushWith: (updates: Partial<D>) => Promise<void>
}

/**
 * Debounced draft persistence for provider settings fields. Edits accumulate
 * in a draft that a debounce timer flushes; an explicit flush persists
 * immediately. The `save` callback reports whether the draft was persisted —
 * only then does the hook clear it, and only when no newer edit superseded
 * the saved version.
 */
function useProviderDraftAutosave<D>(options: {
  delayMs: number
  save: (draft: D | null, updates: Partial<D>) => Promise<boolean>
}): ProviderDraftAutosave<D> {
  const { delayMs } = options
  // The timer and flushes always call the latest save so a library refresh
  // landing mid-debounce cannot resurrect stale fallback values.
  const saveRef = React.useRef(options.save)
  React.useEffect(() => {
    saveRef.current = options.save
  })

  const draftRef = React.useRef<D | null>(null)
  const draftVersion = React.useRef(0)
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [draft, setDraft] = React.useState<D | null>(null)

  const persist = React.useCallback(async (updates: Partial<D>): Promise<void> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const savedVersion = draftVersion.current
    const persisted = await saveRef.current(draftRef.current, updates)
    if (!persisted || draftVersion.current !== savedVersion) return
    draftRef.current = null
    setDraft(null)
  }, [])

  const apply = React.useCallback(
    (resolve: (current: D | null) => D): void => {
      draftRef.current = resolve(draftRef.current)
      draftVersion.current += 1
      setDraft(draftRef.current)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => void persist({}), delayMs)
    },
    [delayMs, persist]
  )

  const edit = React.useCallback((next: D): void => apply(() => next), [apply])
  const editWith = React.useCallback(
    (updater: ProviderDraftUpdater<D>): void => apply(updater),
    [apply]
  )

  const flush = React.useCallback((): Promise<void> => persist({}), [persist])
  const flushWith = React.useCallback(
    (updates: Partial<D>): Promise<void> => persist(updates),
    [persist]
  )
  const cancel = React.useCallback((): void => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
  }, [])

  React.useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    },
    []
  )

  return { draft, edit, editWith, cancel, flush, flushWith }
}

export { useProviderDraftAutosave }
export type { ProviderDraftAutosave }
