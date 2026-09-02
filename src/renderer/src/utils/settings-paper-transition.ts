import { flushSync } from 'react-dom'

function transitionSettingsPage(changePage: () => void): void {
  const shouldSkipTransition =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches || !document.startViewTransition

  if (shouldSkipTransition) {
    changePage()
    return
  }

  document.documentElement.dataset.navigationTransition = 'settings'
  const transition = document.startViewTransition(() => {
    flushSync(changePage)
  })

  void transition.finished.finally(() => {
    delete document.documentElement.dataset.navigationTransition
  })
}

export { transitionSettingsPage }
