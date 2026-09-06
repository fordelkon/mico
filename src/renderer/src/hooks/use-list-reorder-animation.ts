import * as React from 'react'

const prefersReducedMotion = (): boolean =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

function useListReorderAnimation() {
  const elements = React.useRef(new Map<string, HTMLElement>())
  const previousRects = React.useRef<Map<string, DOMRect> | null>(null)
  const animations = React.useRef(new Map<string, Animation>())

  const capture = React.useCallback((): void => {
    previousRects.current = new Map(
      [...elements.current].map(([id, element]) => [id, element.getBoundingClientRect()])
    )
  }, [])

  const itemRef = React.useCallback(
    (id: string) =>
      (element: HTMLElement | null): void => {
        if (element) {
          elements.current.set(id, element)
        } else {
          elements.current.delete(id)
          animations.current.get(id)?.cancel()
          animations.current.delete(id)
        }
      },
    []
  )

  React.useLayoutEffect(() => {
    const previous = previousRects.current
    previousRects.current = null
    if (!previous || prefersReducedMotion()) return

    for (const [id, element] of elements.current) {
      const previousRect = previous.get(id)
      if (!previousRect) continue

      const offset = previousRect.top - element.getBoundingClientRect().top
      if (offset === 0) continue

      animations.current.get(id)?.cancel()
      const animation = element.animate(
        [{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }],
        { duration: 320, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }
      )
      animations.current.set(id, animation)
      animation.onfinish = () => {
        animation.cancel()
        animations.current.delete(id)
      }
    }
  })

  React.useEffect(
    () => () => {
      for (const animation of animations.current.values()) animation.cancel()
    },
    []
  )

  return { capture, itemRef }
}

export { useListReorderAnimation }
