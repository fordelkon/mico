import './window-controls.css'

import { Copy, Minimize2, Minus, MoveDiagonal2, Plus, Square, X } from 'lucide-react'
import * as React from 'react'

import { IconTooltipButton } from '@mico/ui'

function WindowControls(): React.JSX.Element | null {
  const platform = window.electron.process.platform
  const isMac = platform === 'darwin'
  const isWindows = platform === 'win32'
  const [isFullScreen, setIsFullScreen] = React.useState(false)
  const [isMaximized, setIsMaximized] = React.useState(false)
  const [isOptionPressed, setIsOptionPressed] = React.useState(false)
  const [isWindowFocused, setIsWindowFocused] = React.useState(() => document.hasFocus())

  React.useEffect(() => {
    if (!isMac && !isWindows) return undefined

    let isMounted = true
    const removeMaximizedListener = window.api.windowControls.onMaximizedChange(setIsMaximized)

    void window.api.windowControls.isMaximized().then((maximized) => {
      if (isMounted) setIsMaximized(maximized)
    })

    return () => {
      isMounted = false
      removeMaximizedListener()
    }
  }, [isMac, isWindows])

  React.useEffect(() => {
    if (!isMac) return undefined

    let isMounted = true
    const removeFullScreenListener = window.api.windowControls.onFullScreenChange(setIsFullScreen)
    const handleBlur = (): void => {
      setIsOptionPressed(false)
      setIsWindowFocused(false)
    }
    const handleFocus = (): void => setIsWindowFocused(true)
    const handleKeyDown = (event: KeyboardEvent): void => setIsOptionPressed(event.altKey)
    const handleKeyUp = (event: KeyboardEvent): void => setIsOptionPressed(event.altKey)

    void window.api.windowControls.isFullScreen().then((fullScreen) => {
      if (isMounted) setIsFullScreen(fullScreen)
    })

    window.addEventListener('blur', handleBlur)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      isMounted = false
      removeFullScreenListener()
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [isMac])

  if (!isMac && !isWindows) return null

  const toggleMaximize = (): void => {
    if (isMaximized) {
      void window.api.windowControls.unmaximize()
    } else {
      void window.api.windowControls.maximize()
    }
  }

  if (isMac) {
    const isZoomAction = isOptionPressed && !isFullScreen
    const FullScreenIcon = isFullScreen ? Minimize2 : isZoomAction ? Plus : MoveDiagonal2
    const fullScreenLabel = isFullScreen
      ? 'Exit Full Screen'
      : isZoomAction
        ? isMaximized
          ? 'Restore'
          : 'Zoom'
        : 'Enter Full Screen'

    return (
      <header
        aria-label="Window controls"
        className="window-control-group titlebar-control-group"
        data-platform={platform}
        data-window-focused={isWindowFocused}
      >
        <IconTooltipButton
          className="titlebar-button window-control-group__traffic-light window-control-group__close"
          icon={<X aria-hidden="true" />}
          label="Close"
          onClick={() => void window.api.windowControls.close()}
        />
        <IconTooltipButton
          className="titlebar-button window-control-group__traffic-light window-control-group__minimize"
          icon={<Minus aria-hidden="true" />}
          label="Minimize"
          onClick={() => void window.api.windowControls.minimize()}
        />
        <IconTooltipButton
          className="titlebar-button window-control-group__traffic-light window-control-group__zoom"
          icon={<FullScreenIcon aria-hidden="true" />}
          label={fullScreenLabel}
          onClick={
            isZoomAction ? toggleMaximize : () => void window.api.windowControls.toggleFullScreen()
          }
        />
      </header>
    )
  }

  const MaximizeIcon = isMaximized ? Copy : Square
  const maximizeLabel = isMaximized ? 'Restore' : 'Maximize'

  return (
    <header
      aria-label="Window controls"
      className="window-control-group titlebar-control-group"
      data-platform={platform}
    >
      <IconTooltipButton
        className="titlebar-button"
        icon={<Minus aria-hidden="true" />}
        label="Minimize"
        onClick={() => void window.api.windowControls.minimize()}
      />
      <IconTooltipButton
        className="titlebar-button"
        icon={<MaximizeIcon aria-hidden="true" />}
        label={maximizeLabel}
        onClick={toggleMaximize}
      />
      <IconTooltipButton
        className="titlebar-button window-control-group__close"
        icon={<X aria-hidden="true" />}
        label="Close"
        onClick={() => void window.api.windowControls.close()}
      />
    </header>
  )
}

export { WindowControls }
