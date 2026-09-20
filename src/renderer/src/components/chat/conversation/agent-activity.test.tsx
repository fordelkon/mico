import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AgentActivityTimeline,
  AgentLoadingIndicator,
  ThinkingBlock,
  ToolTrace
} from './agent-activity'

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

  it('uses the orb only before an activity item exists', () => {
    const { rerender } = render(<AgentLoadingIndicator />)

    expect(screen.getByTestId('thinking-orb')).toBeVisible()

    rerender(<ThinkingBlock id="reasoning-1" isStreaming text="Inspecting the request." />)

    expect(screen.queryByTestId('thinking-orb')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Thinking/ })).toBeVisible()
  })

  it('lets people reveal a completed thought summary', () => {
    render(<ThinkingBlock id="reasoning-1" isStreaming={false} text="Inspecting the request." />)

    const button = screen.getByRole('button', { name: 'Thought' })
    const summary = screen.getByTestId('thinking-panel').firstElementChild
    if (!(summary instanceof HTMLElement)) throw new Error('Thinking summary is missing.')
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

  it('summarizes a completed write without exposing its file contents', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'call-1',
          toolName: 'write',
          state: 'output-available',
          input: { path: 'src/index.ts', content: 'private implementation details' },
          output: 'Created src/index.ts.'
        }}
      />
    )

    const write = screen.getByRole('button', { name: 'Write src/index.ts Created' })
    fireEvent.click(write)
    expect(screen.getByText('File created')).toBeVisible()
    expect(screen.getByText('1 line')).toBeVisible()
    expect(screen.queryByText('private implementation details')).not.toBeInTheDocument()
  })

  it('renders edit replacements as a file diff', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'edit-1',
          toolName: 'edit',
          state: 'output-available',
          input: { path: 'src/index.ts', edits: [{ oldText: 'before', newText: 'after' }] },
          output: 'Edited src/index.ts.'
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit 1 changes src/index.ts Updated' }))
    expect(screen.getByText('Applied change 1')).toBeVisible()
    expect(screen.getByText('File changes')).toBeVisible()
    expect(screen.getByRole('log', { name: 'File diff' })).toHaveTextContent('before')
    expect(screen.getByRole('log', { name: 'File diff' })).toHaveTextContent('after')
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

  it('renders completed bash calls as a command and terminal output pair', () => {
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

    fireEvent.click(screen.getByRole('button', { name: /Run printf first/ }))
    expect(screen.getByText('Command')).toBeVisible()
    expect(screen.getByText('Output')).toBeVisible()
    expect(screen.getAllByTestId('code-block').at(-1)).toHaveTextContent('first')
    expect(screen.getAllByTestId('code-block').at(-1)).toHaveTextContent('second')
  })

  it('renders live tool deltas through the streaming code block', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'bash-stream-1',
          toolName: 'bash',
          state: 'input-available',
          input: { command: 'pnpm test' },
          liveOutput: { preview: '', stderr: 'warning: cached', stdout: '12 tests passed' }
        }}
      />
    )

    const output = screen
      .getAllByTestId('code-block')
      .find((block) => block.getAttribute('data-state') === 'streaming')
    expect(output).toHaveAttribute('data-state', 'streaming')
    expect(screen.getByText('12 tests passed')).toBeVisible()
    expect(screen.getByText('Standard error')).toBeVisible()
    expect(screen.getByText('warning: cached')).toBeVisible()
    expect(screen.getByRole('button', { name: /Run pnpm test Streaming output/ })).toBeVisible()
  })

  it('marks a write preview as a draft until the file operation completes', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'write-draft-1',
          toolName: 'write',
          state: 'input-available',
          input: { path: 'src/index.ts', content: 'export const answer = 42' }
        }}
      />
    )

    expect(screen.getByRole('button', { name: 'Write src/index.ts Writing file' })).toBeVisible()
    expect(screen.getByText('Preparing file')).toBeVisible()
  })

  it('waits to show a read preview until reading finishes', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'read-running-1',
          toolName: 'read',
          state: 'input-available',
          input: { path: 'src/index.ts' }
        }}
      />
    )

    expect(screen.getByRole('button', { name: 'Read src/index.ts Reading file' })).toBeVisible()
    expect(screen.getByText('Reading file…')).toBeVisible()
    expect(screen.queryByText('File read')).not.toBeInTheDocument()
  })

  it('collapses a tool detail automatically when the run completes', () => {
    const part = {
      type: 'dynamic-tool' as const,
      toolCallId: 'bash-collapse-1',
      toolName: 'bash',
      input: { command: 'pnpm test' }
    }
    const { rerender } = render(<ToolTrace part={{ ...part, state: 'input-available' }} />)

    expect(screen.getByRole('button', { name: /Run pnpm test Running/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    )

    rerender(<ToolTrace part={{ ...part, state: 'output-available', output: 'Tests passed' }} />)

    expect(screen.getByRole('button', { name: /Run pnpm test Completed/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })
})

describe('AgentActivityTimeline', () => {
  it('settles a thought once the next activity part takes over', () => {
    const reasoning = { type: 'reasoning' as const, text: 'Inspecting the request.' }
    const tool = {
      type: 'dynamic-tool' as const,
      toolCallId: 'read-live-1',
      toolName: 'read',
      state: 'input-available' as const,
      input: { path: 'src/index.ts' }
    }
    const { rerender } = render(
      <AgentActivityTimeline
        id="step-live"
        isAnswerStreaming={false}
        isStreaming
        parts={[reasoning]}
      />
    )

    expect(screen.getByRole('button', { name: 'Thinking' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )

    rerender(
      <AgentActivityTimeline
        id="step-live"
        isAnswerStreaming={false}
        isStreaming
        parts={[reasoning, tool]}
      />
    )

    // The finished thought drops the shimmer and collapses like a completed tool.
    expect(screen.getByRole('button', { name: 'Thought' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(screen.getByRole('button', { name: 'Read src/index.ts Reading file' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('collapses a completed model step into a trace summary and reveals its tool details on demand', () => {
    render(
      <AgentActivityTimeline
        id="step-1"
        isAnswerStreaming={false}
        isStreaming={false}
        parts={[
          { type: 'reasoning', text: 'Inspecting the request.' },
          {
            type: 'dynamic-tool',
            toolCallId: 'read-1',
            toolName: 'read',
            state: 'output-available',
            input: { path: 'src/index.ts' },
            output: 'export {}'
          },
          {
            type: 'dynamic-tool',
            toolCallId: 'bash-1',
            toolName: 'bash',
            state: 'output-available',
            input: { command: 'pnpm test' },
            output: 'Tests passed'
          }
        ]}
      />
    )

    const activity = screen.getByRole('button', { name: '2 tool calls · Agent run' })
    expect(activity).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(activity)

    const read = screen.getByRole('button', { name: 'Read src/index.ts Read' })
    const run = screen.getByRole('button', { name: 'Run pnpm test Completed' })
    fireEvent.click(read)
    fireEvent.click(run)

    expect(read).toHaveAttribute('aria-expanded', 'true')
    expect(run).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('File read')).toBeVisible()
    expect(screen.getByText('1 line')).toBeVisible()
    expect(screen.queryByText('export {}')).not.toBeInTheDocument()
    expect(screen.getByText('Output')).toBeVisible()
    expect(screen.getByText('Tests passed')).toBeVisible()
  })
})
