import './window-controls.css'

import { IconTooltipButton } from '@mico/ui'
import { Copy, Minimize2, Minus, MoveDiagonal2, Plus, Square, X } from 'lucide-react'
import * as React from 'react'

type WindowControl = 'close' | 'maximize' | 'minimize'

function isWindowControl(value: string | null): value is WindowControl {
  return value === 'close' || value === 'maximize' || value === 'minimize'
}

function WindowControls(): React.JSX.Element | null {
  const platform = window.electron.process.platform
  const isMac = platform === 'darwin'
  const isWindows = platform === 'win32'
  const [isFullScreen, setIsFullScreen] = React.useState(false)
  const [isMaximized, setIsMaximized] = React.useState(false)
  const [isOptionPressed, setIsOptionPressed] = React.useState(false)
  // Frameless controls can retain CSS hover after tray restore, so visual hover uses fresh pointer events.
  const [hoveredControl, setHoveredControl] = React.useState<WindowControl | null>(null)
  const [isWindowFocused, setIsWindowFocused] = React.useState(false)

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
    const removeFocusListener = window.api.windowControls.onFocusChange((isFocused) => {
      if (!isMounted) return
      if (!isFocused) setHoveredControl(null)
      setIsWindowFocused(isFocused)
    })

    void window.api.windowControls.isFocused().then((isFocused) => {
      if (isMounted) setIsWindowFocused(isFocused)
    })

    return () => {
      isMounted = false
      removeFocusListener()
    }
  }, [isMac])

  React.useEffect(() => {
    if (!isMac) return undefined

    let isMounted = true
    const removeFullScreenListener = window.api.windowControls.onFullScreenChange(setIsFullScreen)
    const handleBlur = (): void => setIsOptionPressed(false)
    const handleKeyDown = (event: KeyboardEvent): void => setIsOptionPressed(event.altKey)
    const handleKeyUp = (event: KeyboardEvent): void => setIsOptionPressed(event.altKey)

    void window.api.windowControls.isFullScreen().then((fullScreen) => {
      if (isMounted) setIsFullScreen(fullScreen)
    })

    window.addEventListener('blur', handleBlur)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      isMounted = false
      removeFullScreenListener()
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [isMac])

  if (!isMac && !isWindows) return null

  const blurActiveControl = (): void => {
    // Tooltips also open on focus, which persists when a window state change completes.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }

  const toggleMaximize = (): void => {
    blurActiveControl()
    if (isMaximized) {
      void window.api.windowControls.unmaximize()
    } else {
      void window.api.windowControls.maximize()
    }
  }

  const closeWindow = (): void => {
    blurActiveControl()
    void window.api.windowControls.close()
  }

  const minimizeWindow = (): void => {
    blurActiveControl()
    void window.api.windowControls.minimize()
  }

  const toggleFullScreen = (): void => {
    blurActiveControl()
    void window.api.windowControls.toggleFullScreen()
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>): void => {
    if (!(event.target instanceof Element)) return

    const control = event.target.closest('[data-window-control]')
    const controlName = control?.getAttribute('data-window-control') ?? null
    setHoveredControl(isWindowControl(controlName) ? controlName : null)
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
        onPointerLeave={() => setHoveredControl(null)}
        onPointerMove={handlePointerMove}
      >
        <IconTooltipButton
          className="titlebar-button window-control-group__traffic-light window-control-group__close"
          data-hovered={hoveredControl === 'close'}
          data-window-control="close"
          icon={<X aria-hidden="true" />}
          label="Close"
          onClick={closeWindow}
        />
        <IconTooltipButton
          className="titlebar-button window-control-group__traffic-light window-control-group__minimize"
          data-hovered={hoveredControl === 'minimize'}
          data-window-control="minimize"
          icon={<Minus aria-hidden="true" />}
          label="Minimize"
          onClick={minimizeWindow}
        />
        <IconTooltipButton
          className="titlebar-button window-control-group__traffic-light window-control-group__zoom"
          data-hovered={hoveredControl === 'maximize'}
          data-window-control="maximize"
          icon={<FullScreenIcon aria-hidden="true" />}
          label={fullScreenLabel}
          onClick={isZoomAction ? toggleMaximize : toggleFullScreen}
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
      onPointerLeave={() => setHoveredControl(null)}
      onPointerMove={handlePointerMove}
    >
      <IconTooltipButton
        className="titlebar-button"
        data-hovered={hoveredControl === 'minimize'}
        data-window-control="minimize"
        icon={<Minus aria-hidden="true" />}
        label="Minimize"
        onClick={minimizeWindow}
      />
      <IconTooltipButton
        className="titlebar-button"
        data-hovered={hoveredControl === 'maximize'}
        data-window-control="maximize"
        icon={<MaximizeIcon aria-hidden="true" />}
        label={maximizeLabel}
        onClick={toggleMaximize}
      />
      <IconTooltipButton
        className="titlebar-button window-control-group__close"
        data-hovered={hoveredControl === 'close'}
        data-window-control="close"
        icon={<X aria-hidden="true" />}
        label="Close"
        onClick={closeWindow}
      />
    </header>
  )
}

export { WindowControls }
