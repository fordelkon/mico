import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

class ResizeObserverMock implements ResizeObserver {
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds = []

  disconnect() {}
  observe() {}
  unobserve() {}
  takeRecords(): ResizeObserverEntry[] {
    return []
  }
}

globalThis.ResizeObserver = ResizeObserverMock

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false
    }),
    writable: true
  })
}

if (!globalThis.PointerEvent) {
  Object.defineProperty(globalThis, 'PointerEvent', {
    configurable: true,
    value: MouseEvent,
    writable: true
  })
}

Object.defineProperties(HTMLElement.prototype, {
  hasPointerCapture: {
    configurable: true,
    value: () => false
  },
  releasePointerCapture: {
    configurable: true,
    value: () => undefined
  },
  scrollIntoView: {
    configurable: true,
    value: () => undefined
  },
  setPointerCapture: {
    configurable: true,
    value: () => undefined
  }
})
