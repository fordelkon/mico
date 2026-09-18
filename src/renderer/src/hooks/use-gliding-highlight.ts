import * as React from 'react'

type HighlightBox = { height: number; top: number }

type GlidingHighlightItemProps<T extends HTMLElement> = {
  onFocus: React.FocusEventHandler<T>
  onMouseEnter: React.MouseEventHandler<T>
  ref: React.RefCallback<T>
}

type GlidingHighlightProps = {
  'aria-hidden': true
  className: string
  style: React.CSSProperties
}

type UseGlidingHighlightResult<T extends HTMLElement> = {
  clearHighlight: () => void
  getItemProps: (index: number) => GlidingHighlightItemProps<T>
  highlightProps: GlidingHighlightProps
}

function useGlidingHighlight<T extends HTMLElement>(): UseGlidingHighlightResult<T> {
  const itemRefs = React.useRef(new Map<number, T>())
  const itemProps = React.useRef(new Map<number, GlidingHighlightItemProps<T>>())
  const [box, setBox] = React.useState<HighlightBox | null>(null)
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null)
  const [engaged, setEngaged] = React.useState(false)

  React.useLayoutEffect(() => {
    if (activeIndex === null) return

    const item = itemRefs.current.get(activeIndex)
    if (!item) return

    const nextBox = { height: item.offsetHeight, top: item.offsetTop }
    setBox((currentBox) =>
      currentBox?.height === nextBox.height && currentBox.top === nextBox.top ? currentBox : nextBox
    )
  }, [activeIndex])

  const highlight = React.useCallback((index: number): void => {
    if (!itemRefs.current.get(index)) return

    setActiveIndex(index)
    setEngaged(true)
  }, [])

  const getItemProps = React.useCallback(
    (index: number): GlidingHighlightItemProps<T> => {
      const existing = itemProps.current.get(index)
      if (existing) return existing

      const props: GlidingHighlightItemProps<T> = {
        onFocus: () => highlight(index),
        onMouseEnter: () => highlight(index),
        ref: (item) => {
          if (item) itemRefs.current.set(index, item)
          else itemRefs.current.delete(index)
        }
      }
      itemProps.current.set(index, props)
      return props
    },
    [highlight]
  )

  return {
    clearHighlight: () => setEngaged(false),
    getItemProps,
    highlightProps: {
      'aria-hidden': true,
      className:
        'pointer-events-none absolute top-0 will-change-[transform,height,opacity] transition-[transform_var(--list-highlight-motion-duration)_var(--list-highlight-motion-easing),height_var(--list-highlight-motion-duration)_var(--list-highlight-motion-easing),opacity_var(--list-highlight-fade-duration)_ease] motion-reduce:transition-none motion-reduce:will-change-auto',
      style: {
        height: box?.height ?? 0,
        opacity: box && engaged ? 1 : 0,
        transform: `translateY(${box?.top ?? 0}px)`
      }
    }
  }
}

export { useGlidingHighlight, type GlidingHighlightItemProps }
