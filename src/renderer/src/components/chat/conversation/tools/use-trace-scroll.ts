import * as React from 'react'

/** Follow a growing detail pane until its reader scrolls away from the end. */
export function useTraceScroll(enabled: boolean) {
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const following = React.useRef(true)
  const follow = React.useCallback(() => {
    const viewport = viewportRef.current
    if (enabled && viewport && viewport.clientHeight > 0 && following.current) {
      viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    }
  }, [enabled])

  React.useLayoutEffect(follow)
  React.useLayoutEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!enabled || !viewport || !content) return
    const observer = new ResizeObserver(follow)
    observer.observe(viewport)
    observer.observe(content)
    return () => observer.disconnect()
  }, [enabled, follow])

  const onScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    const viewport = event.currentTarget
    if (viewport.clientHeight > 0) {
      following.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 4
    }
  }
  return { contentRef, viewportRef, onScroll }
}
