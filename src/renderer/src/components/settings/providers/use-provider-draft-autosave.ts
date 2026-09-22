import * as React from 'react'

import { useAutosaveQueue } from './use-autosave-queue'

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
 * Debounced draft persistence for provider settings fields, built on the
 * shared autosave queue. Edits accumulate in a draft that a debounce timer
 * flushes; an explicit flush persists immediately. The `save` callback reports
 * whether the draft was persisted — only then does the hook clear it, and only
 * when no newer edit superseded the saved version.
 */
function useProviderDraftAutosave<D>(options: {
  delayMs: number
  save: (draft: D | null, updates: Partial<D>) => Promise<boolean>
}): ProviderDraftAutosave<D> {
  const { delayMs } = options
  const saveRef = React.useRef(options.save)
  React.useEffect(() => {
    saveRef.current = options.save
  })

  const draftRef = React.useRef<D | null>(null)
  const draftVersion = React.useRef(0)
  // Explicit flushWith updates ride the next save; the debounce timer persists
  // with none.
  const pendingUpdates = React.useRef<Partial<D>>({})
  const [draft, setDraft] = React.useState<D | null>(null)

  const queue = useAutosaveQueue({
    delayMs,
    save: async () => {
      const savedVersion = draftVersion.current
      const updates = pendingUpdates.current
      pendingUpdates.current = {}
      const persisted = await saveRef.current(draftRef.current, updates)
      if (!persisted || draftVersion.current !== savedVersion) return false
      draftRef.current = null
      setDraft(null)
      return true
    }
  })

  const apply = React.useCallback(
    (resolve: (current: D | null) => D): void => {
      draftRef.current = resolve(draftRef.current)
      draftVersion.current += 1
      setDraft(draftRef.current)
      queue.schedule()
    },
    [queue]
  )

  const edit = React.useCallback((next: D): void => apply(() => next), [apply])
  const editWith = React.useCallback(
    (updater: ProviderDraftUpdater<D>): void => apply(updater),
    [apply]
  )

  const flush = React.useCallback((): Promise<void> => queue.flush(), [queue])
  const flushWith = React.useCallback(
    (updates: Partial<D>): Promise<void> => {
      pendingUpdates.current = updates
      return queue.flush()
    },
    [queue]
  )
  const cancel = React.useCallback((): void => queue.cancel(), [queue])

  return { draft, edit, editWith, cancel, flush, flushWith }
}

export { useProviderDraftAutosave }
export type { ProviderDraftAutosave }
