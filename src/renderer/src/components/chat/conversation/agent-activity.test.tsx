import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  AgentActivityTimeline,
  AgentLoadingIndicator,
  ThinkingBlock,
  ToolTrace
} from './agent-activity'

describe('ThinkingBlock', () => {
  it('user sees compact reasoning when text streams, then details remain optional', () => {
    render(<ThinkingBlock id="reasoning-1" isStreaming text="Inspecting the request." />)

    expect(screen.getByRole('button', { name: 'Thinking' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('user sees a loading status when the agent has no activity yet, then Thinking is announced', () => {
    render(<AgentLoadingIndicator />)

    expect(screen.getByRole('status')).toHaveTextContent('Thinking')
  })

  it('user reveals the thought summary when clicking Thought, then the panel shows', () => {
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

  it('user closes reasoning when it streams, then later content preserves that choice', () => {
    const { rerender } = render(
      <ThinkingBlock id="reasoning-1" isStreaming text="Inspecting the request." />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Thinking' }))
    fireEvent.click(screen.getByRole('button', { name: 'Thinking' }))

    rerender(
      <ThinkingBlock id="reasoning-1" isStreaming text="Inspecting the request. Reading files." />
    )

    expect(screen.getByRole('button', { name: 'Thinking' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    rerender(
      <ThinkingBlock
        id="reasoning-1"
        isStreaming={false}
        text="Inspecting the request. Reading files."
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Thought' }))
    expect(screen.getByTestId('thinking-panel')).toHaveTextContent(
      'Inspecting the request. Reading files.'
    )
  })

  it('user sees a write summarized in its trace, then file contents stay hidden when expanded', () => {
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

  it('user sees edits as a file diff when expanding the trace, then both versions are shown', () => {
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
    const diff = screen.getByRole('log', { name: 'File diff' })
    expect(diff).toHaveTextContent('before')
    expect(diff).toHaveTextContent('after')
  })

  it('user sees structured bash output when the tool returns an object, then it is not marked unavailable', () => {
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

    fireEvent.click(screen.getByRole('button', { name: /Run pnpm test/ }))
    expect(screen.getByText('12 tests passed')).toBeVisible()
    expect(screen.queryByText('Output is unavailable.')).not.toBeInTheDocument()
  })

  it('user sees command and output paired when expanding a bash call, then both render', () => {
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
    const outputBlock = screen.getAllByTestId('code-block').at(-1)
    expect(outputBlock).toHaveTextContent('first')
    expect(outputBlock).toHaveTextContent('second')
  })

  it('user sees live tool deltas when the tool runs, then the code block marks them streaming', () => {
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

    fireEvent.click(screen.getByRole('button', { name: /Run pnpm test/ }))
    const output = screen
      .getAllByTestId('code-block')
      .find((block) => block.getAttribute('data-state') === 'streaming')
    expect(output).toHaveAttribute('data-state', 'streaming')
    expect(screen.getByText('12 tests passed')).toBeVisible()
    expect(screen.getByText('Standard error')).toBeVisible()
    expect(screen.getByText('warning: cached')).toBeVisible()
    expect(screen.getByRole('button', { name: /Run pnpm test Streaming output/ })).toBeVisible()
    expect(screen.getAllByRole('log')).toHaveLength(1)
    expect(screen.queryByText('Writing')).not.toBeInTheDocument()
  })

  it('user sees a draft write preview when the operation is incomplete, then it shows Preparing file', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Write src/index.ts Writing file' }))
    expect(screen.getByText('Preparing file')).toBeVisible()
  })

  it('user sees a read preview pending when reading is unfinished, then no completed read appears', () => {
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
    expect(screen.queryByText('Reading file…')).not.toBeInTheDocument()
    expect(screen.queryByText('File read')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Read src/index.ts Reading file' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('user leaves tool details closed when the run completes, then they remain closed', () => {
    const part = {
      type: 'dynamic-tool' as const,
      toolCallId: 'bash-collapse-1',
      toolName: 'bash',
      input: { command: 'pnpm test' }
    }
    const { rerender } = render(<ToolTrace part={{ ...part, state: 'input-available' }} />)

    expect(screen.getByRole('button', { name: /Run pnpm test Running/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    )

    rerender(<ToolTrace part={{ ...part, state: 'output-available', output: 'Tests passed' }} />)

    expect(screen.getByRole('button', { name: /Run pnpm test Completed/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })
})

describe('AgentActivityTimeline', () => {
  it('user sees a thought settle when the next activity starts, then both details stay compact', () => {
    const reasoning = {
      type: 'reasoning' as const,
      text: 'Inspecting the request.',
      state: 'streaming' as const
    }
    const tool = {
      type: 'dynamic-tool' as const,
      toolCallId: 'bash-live-1',
      toolName: 'bash',
      state: 'input-available' as const,
      input: { command: 'cat package.json' }
    }
    const { rerender } = render(
      <AgentActivityTimeline id="step-live" isStreaming parts={[reasoning]} />
    )

    expect(screen.getByRole('button', { name: 'Thinking' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )

    rerender(
      <AgentActivityTimeline
        id="step-live"
        isStreaming
        parts={[{ ...reasoning, state: 'done' as const }, tool]}
      />
    )

    // The finished thought settles and collapses like a completed tool.
    expect(screen.getByRole('button', { name: 'Thought' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(screen.getByRole('button', { name: 'Run cat package.json Running' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('user sees parallel tools when a batch runs, then all details stay compact', () => {
    const bash = (toolCallId: string) => ({
      type: 'dynamic-tool' as const,
      toolCallId,
      toolName: 'bash' as const,
      state: 'input-available' as const,
      input: { command: `run ${toolCallId}` }
    })
    render(
      <AgentActivityTimeline id="step-batch" isStreaming parts={[bash('call-1'), bash('call-2')]} />
    )

    expect(screen.getByRole('button', { name: 'Run run call-1 Running' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(screen.getByRole('button', { name: 'Run run call-2 Running' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('user sees the step stay open between tools, then it settles once when the step closes', () => {
    const reasoning = {
      type: 'reasoning' as const,
      text: 'Inspecting the request.',
      state: 'streaming' as const
    }
    const read = {
      type: 'dynamic-tool' as const,
      toolCallId: 'read-seq-1',
      toolName: 'read',
      state: 'input-available' as const,
      input: { path: 'src/index.ts' }
    }
    const readDone = { ...read, state: 'output-available' as const, output: 'export {}' }
    const { rerender } = render(
      <AgentActivityTimeline id="step-seq" isStreaming parts={[reasoning]} />
    )

    // The read completes and the run continues without a new part yet: the step
    // must not collapse in the gap between tools.
    rerender(
      <AgentActivityTimeline
        id="step-seq"
        isStreaming
        parts={[{ ...reasoning, state: 'done' as const }, readDone]}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('Working')

    // Interim text closes the step: the run settles exactly once.
    rerender(
      <AgentActivityTimeline
        id="step-seq"
        isSettled
        isStreaming
        parts={[{ ...reasoning, state: 'done' as const }, readDone]}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('1 tool call')
    expect(screen.getByRole('button', { name: 'Agent activity: 1 tool call' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('user sees a model step summarize when it finishes, then expanding it reveals tool details', () => {
    render(
      <AgentActivityTimeline
        id="step-1"
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

    const activity = screen.getByRole('button', { name: 'Agent activity: 2 tool calls' })
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

describe('Activity disclosure and outcomes', () => {
  it('user closes a live group when tools arrive, then it stays closed through completion', () => {
    const { rerender } = render(<AgentActivityTimeline id="live" isStreaming parts={[]} />)
    const header = screen.getByRole('button', { name: 'Agent activity: Thinking' })
    header.focus()
    fireEvent.click(header)
    const tool = {
      type: 'dynamic-tool' as const,
      toolCallId: 'read',
      toolName: 'read',
      state: 'input-available' as const,
      input: { path: 'package.json' }
    }
    rerender(<AgentActivityTimeline id="live" isStreaming parts={[tool]} />)
    expect(
      screen.getByRole('button', { name: 'Agent activity: Reading package.json' })
    ).toHaveAttribute('aria-expanded', 'false')
    rerender(
      <AgentActivityTimeline
        id="live"
        isStreaming={false}
        parts={[{ ...tool, state: 'output-available', output: '{}' }]}
      />
    )
    expect(screen.getByRole('button', { name: 'Agent activity: 1 tool call' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(header).toHaveFocus()
  })

  it('user opens a live tool when inspecting output, then it stays open after completion', () => {
    const part = {
      type: 'dynamic-tool' as const,
      toolCallId: 'terminal',
      toolName: 'bash',
      input: { command: 'pnpm test' }
    }
    const { rerender } = render(<ToolTrace part={{ ...part, state: 'input-available' }} />)
    const trigger = screen.getByRole('button', { name: 'Run pnpm test Running' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    rerender(<ToolTrace part={{ ...part, state: 'output-available', output: 'Tests passed' }} />)
    expect(screen.getByRole('button', { name: 'Run pnpm test Completed' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(screen.getByRole('log', { name: 'Terminal output' })).toHaveTextContent('Tests passed')
  })

  it('user sees a failed edit when rich input exists, then the error remains visible', () => {
    render(
      <AgentActivityTimeline
        id="failed"
        isStreaming={false}
        parts={[
          {
            type: 'dynamic-tool',
            toolCallId: 'edit-error',
            toolName: 'edit',
            state: 'output-error',
            input: { path: 'index.ts', edits: [{ oldText: 'old', newText: 'new' }] },
            errorText: 'Could not edit index.ts. Read the file and try again.'
          }
        ]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Agent activity: 1 tool call · 1 failed' }))
    expect(screen.getByText('Could not edit index.ts. Read the file and try again.')).toBeVisible()
    expect(screen.queryByText('Applied change 1')).not.toBeInTheDocument()
  })

  it('user sees an unfinished tool when generation ends, then it is not reported as completed', () => {
    render(
      <AgentActivityTimeline
        id="interrupted"
        isStreaming={false}
        parts={[
          {
            type: 'dynamic-tool',
            toolCallId: 'pending',
            toolName: 'bash',
            state: 'input-available',
            input: { command: 'pnpm test' }
          }
        ]}
      />
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Agent activity: 1 tool call · 1 not completed' })
    )
    expect(screen.getByRole('button', { name: 'Run pnpm test Not completed' })).toBeVisible()
    expect(screen.queryByText('Completed')).not.toBeInTheDocument()
  })

  it('user sees parallel tools when the newest call finishes, then earlier running work stays identified', () => {
    render(
      <AgentActivityTimeline
        id="parallel"
        isStreaming
        parts={[
          {
            type: 'dynamic-tool',
            toolCallId: 'a',
            toolName: 'read',
            state: 'input-available',
            input: { path: 'package.json' }
          },
          {
            type: 'dynamic-tool',
            toolCallId: 'b',
            toolName: 'read',
            state: 'output-available',
            input: { path: 'README.md' },
            output: 'Readme'
          }
        ]}
      />
    )
    expect(
      screen.getByRole('button', { name: 'Agent activity: Reading package.json' })
    ).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('Unfinished tool details', () => {
  it('user opens a command when output is pending, then every command line is readable', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolName: 'bash',
          toolCallId: 'multiline',
          state: 'input-available',
          input: { command: 'pnpm test\nprintf finished' }
        }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Run pnpm test Running' }))
    expect(screen.getByText(/printf finished/)).toBeVisible()
  })

  it('user opens an unfinished write when generation stops, then it does not claim to be preparing or written', () => {
    render(
      <ToolTrace
        isActive={false}
        part={{
          type: 'dynamic-tool',
          toolName: 'write',
          toolCallId: 'write-stopped',
          state: 'input-available',
          input: { path: 'index.ts', content: 'export {}' }
        }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Write index.ts Not completed' }))
    expect(screen.getByText('Write not confirmed')).toBeVisible()
    expect(screen.queryByText('Preparing file')).not.toBeInTheDocument()
    expect(screen.queryByText('File written')).not.toBeInTheDocument()
  })

  it('user opens an unfinished edit when generation stops, then changes remain proposals without running feedback', () => {
    render(
      <ToolTrace
        isActive={false}
        part={{
          type: 'dynamic-tool',
          toolName: 'edit',
          toolCallId: 'edit-stopped',
          state: 'input-available',
          input: { path: 'index.ts', edits: [{ oldText: 'old', newText: 'new' }] }
        }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit 1 changes index.ts Not completed' }))
    expect(screen.getByText('Changes not confirmed')).toBeVisible()
    expect(screen.getByText('Proposed change 1')).toBeVisible()
    expect(screen.queryByText('Applying changes')).not.toBeInTheDocument()
  })
})
