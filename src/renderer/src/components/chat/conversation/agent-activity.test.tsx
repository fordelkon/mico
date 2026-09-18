import '@testing-library/jest-dom/vitest'

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThinkingBlock, ToolTrace } from './agent-activity'

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ThinkingBlock', () => {
  it('exposes a labeled, expanded disclosure while reasoning streams', () => {
    render(<ThinkingBlock id="reasoning-1" isStreaming text="" />)

    expect(screen.getByRole('button', { name: 'Thinking' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('lets people reveal a completed thought summary', () => {
    render(<ThinkingBlock id="reasoning-1" isStreaming={false} text="Inspecting the request." />)

    const button = screen.getByRole('button', { name: 'Thought summary' })
    const summary = screen.getByText('Inspecting the request.')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(summary).toHaveAttribute('aria-hidden', 'true')

    fireEvent.click(button)

    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(summary).toHaveAttribute('aria-hidden', 'false')
  })

  it('follows streamed reasoning without starting a smooth scroll animation', () => {
    const scrollTo = vi.fn()
    const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollTo
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      callback(performance.now())
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', (): void => undefined)

    try {
      render(<ThinkingBlock id="reasoning-1" isStreaming text="Inspecting the request." />)

      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
    } finally {
      if (originalScrollTo)
        Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
    }
  })

  it('summarizes a completed write without exposing its contents', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'call-1',
          toolName: 'write',
          state: 'output-available',
          input: { path: 'src/index.ts', content: 'private implementation details' },
          output: 'Successfully wrote src/index.ts.'
        }}
      />
    )

    expect(screen.getByRole('button', { name: 'Write src/index.tsCompleted' })).toBeVisible()
    expect(screen.queryByText('private implementation details')).not.toBeInTheDocument()
  })

  it('shows structured bash output instead of treating it as unavailable', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'call-2',
          toolName: 'bash',
          state: 'output-available',
          input: { command: 'pnpm test' },
          output: { output: '12 tests passed' }
        }}
      />
    )

    expect(screen.getByText('12 tests passed')).toBeVisible()
    expect(screen.queryByText('Output is unavailable.')).not.toBeInTheDocument()
  })

  it('reveals completed bash output line by line instead of showing it all at once', async () => {
    vi.useFakeTimers()

    try {
      render(
        <ToolTrace
          part={{
            type: 'dynamic-tool',
            toolCallId: 'call-3',
            toolName: 'bash',
            state: 'output-available',
            input: { command: 'printf first\\nprintf second' },
            output: 'first\nsecond'
          }}
        />
      )

      expect(screen.getByText('first')).toBeVisible()
      expect(screen.queryByText('second')).not.toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(48)
      })

      expect(screen.getByText('second')).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })
})
