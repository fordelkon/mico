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
  it('user follows a thought when it settles, then its excerpt appears and the full text remains expandable', () => {
    const text = 'Checking the file layout.\nThen inspect the output rendering.'
    const { rerender } = render(<ThinkingBlock id="excerpt" isStreaming text={text} />)
    expect(screen.getByRole('button', { name: 'Thinking' })).not.toHaveTextContent(
      'Checking the file layout.'
    )
    rerender(<ThinkingBlock id="excerpt" isStreaming={false} text={text} />)
    const trigger = screen.getByRole('button', { name: 'Thought' })
    expect(trigger).toHaveTextContent('Checking the file layout.')
    fireEvent.click(trigger)
    expect(screen.getByLabelText('Reasoning')).toHaveTextContent(
      'Then inspect the output rendering.'
    )
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })
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
})

describe('ToolTrace', () => {
  it('user expands an update when its diff streams, then the same readable diff survives completion', () => {
    const part = {
      type: 'dynamic-tool' as const,
      toolCallId: 'diff-stream',
      toolName: 'Edit',
      input: {
        file_path: 'index.ts',
        old_string: 'header\nbefore\nfooter',
        new_string: 'header\nafter\nfooter'
      }
    }
    const { rerender } = render(
      <ToolTrace
        part={{
          ...part,
          state: 'input-available',
          liveOutput: { preview: '- before\n+ after', stdout: '', stderr: '' }
        }}
      />
    )
    expect(screen.queryByRole('log')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Update index.ts Applying changes…' }))
    const diff = screen.getByRole('log', { name: 'File diff' })
    expect(diff).toHaveTextContent('-before+after')
    expect(screen.getByText('+1')).toBeVisible()
    expect(screen.getByText('-1')).toBeVisible()
    expect(screen.getByText('Proposed change 1')).toBeVisible()
    rerender(
      <ToolTrace part={{ ...part, state: 'output-available', output: 'Updated index.ts.' }} />
    )
    expect(screen.getByRole('log', { name: 'File diff' })).toBe(diff)
    expect(screen.getByText('Changes applied')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Update index.ts Added 1 line, removed 1 line.' })
    ).toHaveAttribute('aria-expanded', 'true')
  })
  it('user sees a write summarized when collapsed, then expanding reveals the written contents', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'call-1',
          toolName: 'Write',
          state: 'output-available',
          input: { file_path: 'src/index.ts', content: 'private implementation details' },
          output: 'Created src/index.ts.'
        }}
      />
    )

    const write = screen.getByRole('button', {
      name: 'Write src/index.ts Wrote 1 line to src/index.ts.'
    })
    expect(screen.getByText('Wrote 1 line to src/index.ts.')).toBeVisible()
    fireEvent.click(write)
    expect(screen.getByText('File created')).toBeVisible()
    expect(screen.getByText('1 line')).toBeVisible()
    expect(screen.getByText('private implementation details')).toBeVisible()
  })

  it('user sees edits summarized as line counts, then both diff versions show when expanded', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'edit-1',
          toolName: 'Edit',
          state: 'output-available',
          input: { file_path: 'src/index.ts', old_string: 'before', new_string: 'after' },
          output: 'Edited src/index.ts.'
        }}
      />
    )

    const edit = screen.getByRole('button', {
      name: 'Update src/index.ts Added 1 line, removed 1 line.'
    })
    fireEvent.click(edit)
    expect(screen.getByText('Applied change 1')).toBeVisible()
    expect(screen.getByText('File changes')).toBeVisible()
    const diff = screen.getByRole('log', { name: 'File diff' })
    expect(diff).toHaveTextContent('before')
    expect(diff).toHaveTextContent('after')
  })

  it('user sees the bash output head in the result line when the call completes, then the terminal pairs it with the command', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'call-3',
          toolName: 'Bash',
          state: 'output-available',
          input: { command: 'printf first\nprintf second' },
          output: 'first\nsecond'
        }}
      />
    )

    expect(screen.getByText('first')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /Bash printf first/ }))
    expect(screen.getByText('Command')).toBeVisible()
    expect(screen.getByText('Output')).toBeVisible()
    const outputBlock = screen.getAllByTestId('code-block').at(-1)
    expect(outputBlock).toHaveTextContent('second')
  })

  it('user opens a running command when output arrives, then stdout and stderr appear in its details', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'bash-stream-1',
          toolName: 'Bash',
          state: 'input-available',
          input: { command: 'pnpm test' },
          liveOutput: { preview: '', stderr: 'warning: cached', stdout: '12 tests passed' }
        }}
      />
    )

    expect(screen.queryByRole('log')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Bash pnpm test Running…' }))
    const output = screen
      .getAllByTestId('code-block')
      .find((block) => block.getAttribute('data-state') === 'streaming')
    expect(output).toHaveAttribute('data-state', 'streaming')
    expect(screen.getAllByText('12 tests passed').length).toBeGreaterThan(0)
    expect(screen.getByText('Standard error')).toBeVisible()
    expect(screen.getByText('warning: cached')).toBeVisible()
    expect(screen.getAllByRole('log')).toHaveLength(1)
  })

  it('user sees a draft write preview when the operation is incomplete, then it shows Preparing file', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'write-draft-1',
          toolName: 'Write',
          state: 'input-available',
          input: { file_path: 'src/index.ts', content: 'export const answer = 42' }
        }}
      />
    )

    expect(screen.getByRole('button', { name: 'Write src/index.ts Writing file…' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Write src/index.ts Writing file…' }))
    expect(screen.getByText('Preparing file')).toBeVisible()
  })

  it('user sees a read as a single summary line when it runs, then no panel competes with it', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'read-running-1',
          toolName: 'Read',
          state: 'input-available',
          input: { file_path: 'src/index.ts' }
        }}
      />
    )

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Reading file…')).toBeVisible()
    expect(screen.getByText('(src/index.ts)')).toBeVisible()
  })

  it('user sees a completed read counted in lines when collapsed, then expanding reveals its contents', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'read-done-1',
          toolName: 'Read',
          state: 'output-available',
          input: { file_path: 'src/index.ts' },
          output: 'export {}\nexport const done = true\n[More content available.]'
        }}
      />
    )

    expect(screen.getByText('Read 2 lines.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Read src/index.ts Read 2 lines.' }))
    expect(screen.getByRole('log', { name: 'File content' })).toHaveTextContent(
      'export const done = true'
    )
  })

  it('user leaves tool details closed when the run completes, then they remain closed', () => {
    const part = {
      type: 'dynamic-tool' as const,
      toolCallId: 'bash-collapse-1',
      toolName: 'Bash',
      input: { command: 'pnpm test' }
    }
    const { rerender } = render(<ToolTrace part={{ ...part, state: 'input-available' }} />)

    expect(screen.getByRole('button', { name: 'Bash pnpm test Running…' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )

    rerender(<ToolTrace part={{ ...part, state: 'output-available', output: 'Tests passed' }} />)

    expect(screen.getByRole('button', { name: 'Bash pnpm test Tests passed' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('user sees a failed mutation refuse its proposal when the row renders, then the error names the recovery', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'edit-failed-1',
          toolName: 'Edit',
          state: 'output-error',
          input: { file_path: 'index.ts', old_string: 'old', new_string: 'new' },
          errorText: 'Could not edit index.ts.\nRead the file and try again.'
        }}
      />
    )

    expect(screen.getByText('Could not edit index.ts.')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('old')).not.toBeInTheDocument()
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
      toolName: 'Bash',
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
    expect(screen.getByRole('button', { name: 'Bash cat package.json Running…' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('user sees parallel tools when a batch runs, then all details stay compact', () => {
    const bash = (toolCallId: string) => ({
      type: 'dynamic-tool' as const,
      toolCallId,
      toolName: 'Bash' as const,
      state: 'input-available' as const,
      input: { command: `run ${toolCallId}` }
    })
    render(
      <AgentActivityTimeline id="step-batch" isStreaming parts={[bash('call-1'), bash('call-2')]} />
    )

    expect(screen.getByRole('button', { name: 'Bash run call-1 Running…' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(screen.getByRole('button', { name: 'Bash run call-2 Running…' })).toHaveAttribute(
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
      toolName: 'Read',
      state: 'input-available' as const,
      input: { file_path: 'src/index.ts' }
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
            toolName: 'Read',
            state: 'output-available',
            input: { file_path: 'src/index.ts' },
            output: 'export {}'
          },
          {
            type: 'dynamic-tool',
            toolCallId: 'bash-1',
            toolName: 'Bash',
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

    expect(screen.getByText('Read 1 line.')).toBeVisible()
    const run = screen.getByRole('button', { name: 'Bash pnpm test Tests passed' })
    fireEvent.click(run)

    expect(run).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Output')).toBeVisible()
    expect(screen.getAllByText('Tests passed').length).toBeGreaterThan(0)
  })
})

describe('Read group collapsing', () => {
  it('user collapses consecutive reads into one group line when two arrive together, then expands to the individual traces', () => {
    render(
      <AgentActivityTimeline
        id="group"
        isStreaming={false}
        parts={[
          {
            type: 'dynamic-tool',
            toolCallId: 'read-a',
            toolName: 'Read',
            state: 'output-available',
            input: { file_path: 'a.ts' },
            output: 'one'
          },
          {
            type: 'dynamic-tool',
            toolCallId: 'read-b',
            toolName: 'Read',
            state: 'output-available',
            input: { file_path: 'b.ts' },
            output: 'two\nlines'
          }
        ]}
      />
    )

    const activity = screen.getByRole('button', { name: 'Agent activity: 2 tool calls' })
    fireEvent.click(activity)

    const group = screen.getByRole('button', { name: 'Read 2 files' })
    expect(group).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('b.ts')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Read a.ts Read 1 line.' })).not.toBeInTheDocument()

    fireEvent.click(group)

    // Each read keeps its own summary and optional content disclosure.
    expect(screen.getByText('Read 1 line.')).toBeVisible()
    expect(screen.getByText('Read 2 lines.')).toBeVisible()
    expect(screen.getByText('(a.ts)')).toBeVisible()
    expect(screen.getByText('(b.ts)')).toBeVisible()
  })

  it('user sees a lone read keep its own invocation header when only one arrives, then no group wraps it', () => {
    render(
      <AgentActivityTimeline
        id="lone-read"
        isStreaming={false}
        parts={[
          {
            type: 'dynamic-tool',
            toolCallId: 'read-only',
            toolName: 'Read',
            state: 'output-available',
            input: { file_path: 'a.ts' },
            output: 'one'
          }
        ]}
      />
    )

    expect(screen.queryByRole('button', { name: 'Read 1 file' })).not.toBeInTheDocument()
    expect(screen.getByText('Read 1 line.')).toBeVisible()
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
      toolName: 'Read',
      state: 'input-available' as const,
      input: { file_path: 'package.json' }
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
      toolName: 'Bash',
      input: { command: 'pnpm test' }
    }
    const { rerender } = render(<ToolTrace part={{ ...part, state: 'input-available' }} />)
    const trigger = screen.getByRole('button', { name: 'Bash pnpm test Running…' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    rerender(<ToolTrace part={{ ...part, state: 'output-available', output: 'Tests passed' }} />)
    expect(screen.getByRole('button', { name: 'Bash pnpm test Tests passed' })).toHaveAttribute(
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
            toolName: 'Edit',
            state: 'output-error',
            input: { file_path: 'index.ts', old_string: 'old', new_string: 'new' },
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
            toolName: 'Bash',
            state: 'input-available',
            input: { command: 'pnpm test' }
          }
        ]}
      />
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Agent activity: 1 tool call · 1 not completed' })
    )
    expect(screen.getByRole('button', { name: 'Bash pnpm test Not completed.' })).toBeVisible()
    expect(screen.queryByText('Completed.')).not.toBeInTheDocument()
  })

  it('user sees parallel reads collapse when the newest call finishes, then the group line runs', () => {
    render(
      <AgentActivityTimeline
        id="parallel"
        isStreaming
        parts={[
          {
            type: 'dynamic-tool',
            toolCallId: 'a',
            toolName: 'Read',
            state: 'input-available',
            input: { file_path: 'package.json' }
          },
          {
            type: 'dynamic-tool',
            toolCallId: 'b',
            toolName: 'Read',
            state: 'output-available',
            input: { file_path: 'README.md' },
            output: 'Readme'
          }
        ]}
      />
    )
    expect(
      screen.getByRole('button', { name: 'Agent activity: Reading package.json' })
    ).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Reading 2 files…' })).toBeVisible()
  })
})

describe('Unfinished tool details', () => {
  it('user opens a command when output is pending, then every command line is readable', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolName: 'Bash',
          toolCallId: 'multiline',
          state: 'input-available',
          input: { command: 'pnpm test\nprintf finished' }
        }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Bash pnpm test Running…' }))
    expect(screen.getByText(/printf finished/)).toBeVisible()
  })

  it('user opens an unfinished write when generation stops, then it does not claim to be preparing or written', () => {
    render(
      <ToolTrace
        isActive={false}
        part={{
          type: 'dynamic-tool',
          toolName: 'Write',
          toolCallId: 'write-stopped',
          state: 'input-available',
          input: { file_path: 'index.ts', content: 'export {}' }
        }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Write index.ts Not completed.' }))
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
          toolName: 'Edit',
          toolCallId: 'edit-stopped',
          state: 'input-available',
          input: { file_path: 'index.ts', old_string: 'old', new_string: 'new' }
        }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Update index.ts Not completed.' }))
    expect(screen.getByText('Changes not confirmed')).toBeVisible()
    expect(screen.getByText('Proposed change 1')).toBeVisible()
    expect(screen.queryByText('Applying changes')).not.toBeInTheDocument()
  })
})
