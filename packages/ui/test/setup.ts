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
