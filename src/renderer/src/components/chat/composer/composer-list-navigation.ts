import type * as React from 'react'

/** Arrow/Home/End focus navigation shared by the composer's two search menus. */
function handleComposerListNavigation(event: React.KeyboardEvent<HTMLElement>): void {
  // Browser buttons activate on Enter even without a custom handler. Keep
  // modified/IME Enter from selecting an option in these portalled menus.
  if (
    event.key === 'Enter' &&
    (event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229)
  ) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (
    event.nativeEvent.isComposing ||
    event.nativeEvent.keyCode === 229 ||
    event.key === 'Process' ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return
  const root =
    event.target instanceof HTMLElement
      ? (event.target.closest('[data-slot="popover-content"]') ?? event.currentTarget)
      : event.currentTarget
  const options = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)')
  )
  if (!options.length) return
  const targetIsSearch = event.target instanceof HTMLInputElement
  // Home/End retain native caret behavior in the query; arrows enter results.
  if (targetIsSearch && (event.key === 'Home' || event.key === 'End')) return
  const currentIndex = options.findIndex((option) => option === document.activeElement)
  let nextIndex: number
  switch (event.key) {
    case 'ArrowDown':
      nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % options.length
      break
    case 'ArrowUp':
      nextIndex =
        currentIndex === -1
          ? options.length - 1
          : (currentIndex + options.length - 1) % options.length
      break
    case 'Home':
      nextIndex = 0
      break
    case 'End':
      nextIndex = options.length - 1
      break
    default:
      return
  }
  event.preventDefault()
  options[nextIndex].focus()
  options[nextIndex].scrollIntoView?.({ block: 'nearest' })
}

export { handleComposerListNavigation }
