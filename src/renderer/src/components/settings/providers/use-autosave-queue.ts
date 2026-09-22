import * as React from 'react'

type AutosaveQueue = {
  /** Advance the revision, mark the state dirty, and (re)start the debounce timer. */
  schedule: () => void
  /** Cancel the debounce timer and persist immediately; errors reach the caller. */
  flush: () => Promise<void>
  /** Cancel the debounce timer, keeping the state dirty for the next flush. */
  cancel: () => void
  /** Cancel the timer, drain in-flight saves, then persist if still dirty. */
  settle: () => Promise<void>
  /** Monotonic revision of scheduled changes, for staleness comparisons. */
  revision: () => number
}

/**
 * Serialized debounced persistence for whole-state snapshots. Every schedule
 * advances one revision; a save only reports success for its own revision, so
 * a stale debounced snapshot can never be treated as current. The save returns
 * whether the state was persisted — false (a clean no-op or an unpersisted
 * draft) keeps the queue dirty for the next settle.
 */
function useAutosaveQueue(options: {
  delayMs: number
  save: (atRevision: number) => Promise<boolean>
}): AutosaveQueue {
  const { delayMs } = options
  // The timer and flushes always call the latest save so a refresh landing
  // mid-debounce cannot resurrect stale closure state.
  const saveRef = React.useRef(options.save)
  React.useEffect(() => {
    saveRef.current = options.save
  })

  const revisionRef = React.useRef(0)
  const hasUnsaved = React.useRef(false)
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveQueue = React.useRef(Promise.resolve())

  const run = React.useCallback(async (): Promise<void> => {
    const tail = saveQueue.current.catch(() => undefined)
    const task = tail.then(async () => {
      const atRevision = revisionRef.current
      const persisted = await saveRef.current(atRevision)
      if (persisted && revisionRef.current === atRevision) hasUnsaved.current = false
    })
    saveQueue.current = task
    await task
  }, [])

  const cancelTimer = React.useCallback((): void => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
  }, [])

  const schedule = React.useCallback((): void => {
    revisionRef.current += 1
    hasUnsaved.current = true
    cancelTimer()
    // A failing debounced save has no awaiter; the next edit or flush retries it.
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      void run().catch(() => undefined)
    }, delayMs)
  }, [cancelTimer, delayMs, run])

  const flush = React.useCallback(async (): Promise<void> => {
    cancelTimer()
    await run()
  }, [cancelTimer, run])

  const settle = React.useCallback(async (): Promise<void> => {
    cancelTimer()
    await saveQueue.current.catch(() => undefined)
    if (hasUnsaved.current) await run()
  }, [cancelTimer, run])

  React.useEffect(
    () => () => {
      cancelTimer()
    },
    [cancelTimer]
  )

  // The exposed object must be stable across renders: consumers memoize
  // context values on it, and a fresh object would re-render them every time.
  return React.useMemo(
    () => ({
      schedule,
      flush,
      cancel: cancelTimer,
      settle,
      revision: () => revisionRef.current
    }),
    [cancelTimer, flush, schedule, settle]
  )
}

export { useAutosaveQueue }
export type { AutosaveQueue }
