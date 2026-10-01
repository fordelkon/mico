import '@testing-library/jest-dom/vitest'

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AgentActivityTimeline,
  AgentLoadingIndicator,
  ThinkingBlock,
  ToolTrace
} from './agent-activity'

afterEach(() => {
  vi.useRealTimers()
})

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
  it('user sees an update stay compact when running, then can inspect its highlighted diff', async () => {
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
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Applying changes…')).toBeVisible()
    rerender(
      <ToolTrace part={{ ...part, state: 'output-available', output: 'Updated index.ts.' }} />
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Update index.ts Added 1 line, removed 1 line.' })
    )
    const diff = screen.getByRole('log', { name: 'File diff' })
    expect(diff).toHaveTextContent('-before+after')
    await expect.poll(() => diff.querySelectorAll('[data-code-token]').length).toBeGreaterThan(0)
  })
  it('user sees a write summarized when collapsed, then expanding reveals highlighted contents', async () => {
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
    expect(screen.getByText('File preview')).toBeVisible()
    expect(screen.getByText('private implementation details')).toBeVisible()
    await expect
      .poll(() => screen.getByTestId('code-block').querySelectorAll('[data-code-token]').length)
      .toBeGreaterThan(0)
  })

  it('user views an absolute file path when a write completes, then sees a compact path with a full tooltip', () => {
    const fullPath =
      '/Users/delkon/Library/Application Support/Mico/workspaces/default/quicksort-demo/src/lib.rs'

    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'absolute-write-1',
          toolName: 'Write',
          state: 'output-available',
          input: { file_path: fullPath, content: 'pub fn quicksort() {}' },
          output: 'Created file.'
        }}
      />
    )

    expect(
      screen.getByRole('button', {
        name: `Write ${fullPath} Wrote 1 line to …/quicksort-demo/src/lib.rs.`
      })
    ).toBeVisible()
    expect(screen.getByTitle(fullPath)).toHaveTextContent('(…/quicksort-demo/src/lib.rs)')
    expect(screen.queryByText(`(${fullPath})`)).not.toBeInTheDocument()
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
    const diff = screen.getByRole('log', { name: 'File diff' })
    expect(diff).toHaveTextContent('before')
    expect(diff).toHaveTextContent('after')
  })

  it('user sees recent bash output when the call completes, then details do not repeat the command', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'call-3',
          toolName: 'Bash',
          state: 'output-available',
          input: { command: 'pnpm test' },
          output: 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6'
        }}
      />
    )

    const note = screen.getByText('+1 earlier line')
    expect(note.parentElement).toHaveTextContent('line 2')
    expect(note.parentElement).toHaveTextContent('line 6')
    expect(note.parentElement).not.toHaveTextContent('line 1')
    fireEvent.click(screen.getByRole('button', { name: 'Bash pnpm test Output available' }))
    expect(screen.queryByText('Command')).not.toBeInTheDocument()
    expect(screen.getByText('Output')).toBeVisible()
    expect(screen.getAllByTitle('pnpm test')).toHaveLength(1)
    expect(screen.getByRole('log', { name: 'Terminal output' })).toHaveTextContent('line 1')
  })

  it('user sees the true output tail when a completed command is very long, then early content stays hidden', () => {
    const { container } = render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'long-bash-tail',
          toolName: 'Bash',
          state: 'output-available',
          input: { command: 'cargo test' },
          output: `EARLIEST MARKER\n${'filler\n'.repeat(500)}UNIQUE FINAL RESULT`
        }}
      />
    )

    const summary = container.querySelector('.agent-activity__result--output')
    expect(summary).toHaveTextContent('UNIQUE FINAL RESULT')
    expect(summary).not.toHaveTextContent('EARLIEST MARKER')
  })

  it('user scans a workspace command when it includes a directory wrapper, then sees the meaningful action first', () => {
    const command =
      'cd "/Users/delkon/Library/Application Support/Mico/workspaces/default/quicksort-demo" && cargo test 2>&1 | tail -25'
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'wrapped-bash-1',
          toolName: 'Bash',
          state: 'output-available',
          input: { command },
          output: 'test result: ok'
        }}
      />
    )

    expect(
      screen.getByRole('button', {
        name: 'Bash cargo test 2>&1 | tail -25 Output available'
      })
    ).toBeVisible()
    expect(screen.getByTitle(command)).toHaveTextContent('(cargo test 2>&1 | tail -25)')
  })

  it('user sees a failed command when stderr is available, then the actionable final line is visible', () => {
    const { container } = render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'failed-bash-1',
          toolName: 'Bash',
          state: 'output-error',
          input: { command: 'cargo clippy' },
          errorText: 'Command exited with code 1',
          liveOutput: {
            preview: '',
            stdout: '',
            stderr: 'Checking crate\nerror: could not compile `quicksort-demo`'
          }
        }}
      />
    )

    const result = container.querySelector('.agent-activity__result--error')
    expect(result).toHaveTextContent('Command exited with code 1')
    expect(result).toHaveTextContent('error: could not compile `quicksort-demo`')
  })

  it('user sees a failed command when its error has terminal controls, then the headline is plain text', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'failed-ansi-bash',
          toolName: 'Bash',
          state: 'output-error',
          input: { command: 'cargo test' },
          errorText: '\u001b[31mCommand failed\u001b[0m'
        }}
      />
    )

    expect(screen.getByText('Command failed')).toBeVisible()
    expect(document.body.textContent).not.toContain(String.fromCodePoint(27))
  })

  it('user views a collapsed command when output has formatting controls, then sees clean text', () => {
    const { container } = render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'ansi-bash-1',
          toolName: 'Bash',
          state: 'output-available',
          input: { command: 'cargo fmt --check' },
          output: '\u001b[31m-error\u001b(B\u001b[0m\n\u001b[32m+formatted\u001b[0m'
        }}
      />
    )

    const summary = container.querySelector('.agent-activity__result--output')
    expect(summary).toHaveTextContent('-error')
    expect(summary).toHaveTextContent('+formatted')
    expect(summary).not.toHaveTextContent('\u001b')
    expect(summary).not.toHaveTextContent('(B')
  })

  it('user views terminal hyperlinks when output contains OSC controls, then only the visible label remains', () => {
    const { container } = render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'osc-bash-1',
          toolName: 'Bash',
          state: 'output-available',
          input: { command: 'printf link' },
          output: '\u001b]8;;https://secret.example\u0007visible link\u001b]8;;\u001b\\\nfinished'
        }}
      />
    )

    const summary = container.querySelector('.agent-activity__result--output')
    expect(summary).toHaveTextContent('visible link')
    expect(summary).toHaveTextContent('finished')
    expect(summary).not.toHaveTextContent('secret.example')
    expect(summary).not.toHaveTextContent('\u001b')
  })

  it('user encounters an unfamiliar tool when it completes, then can inspect its input and output', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'weather-1',
          toolName: 'Weather',
          state: 'output-available',
          input: { city: 'Shanghai', units: 'metric' },
          output: '{"temperature":21}'
        }}
      />
    )

    const tool = screen.getByRole('button', { name: 'Weather Completed.' })
    fireEvent.click(tool)
    expect(screen.getByText('Input')).toBeVisible()
    expect(screen.getByText('Output')).toBeVisible()
    expect(screen.getByRole('log', { name: 'Tool input' })).toHaveTextContent('Shanghai')
    expect(screen.getByRole('log', { name: 'Tool output' })).toHaveTextContent('temperature')
  })

  it('user revisits a persisted command when output is restored, then its recent result stays visible', () => {
    const { container } = render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'persisted-bash',
          toolName: 'Bash',
          state: 'output-available',
          input: {
            command: 'cargo --version && rustc --version',
            __micoPresentation: {
              type: 'bash',
              content: 'cargo 1.95.0\nrustc 1.95.0',
              isTruncated: false
            }
          },
          output: 'Command completed.'
        }}
      />
    )

    expect(
      screen.getByRole('button', {
        name: 'Bash cargo --version && rustc --version Output available'
      })
    ).toBeVisible()
    const summary = container.querySelector('.agent-activity__result--output')
    expect(summary).toHaveTextContent('cargo 1.95.0')
    expect(summary).toHaveTextContent('rustc 1.95.0')
  })

  it('user sees recent output when a command runs, then full stdout and stderr remain inspectable', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'bash-stream-1',
          toolName: 'Bash',
          state: 'input-available',
          input: { command: 'pnpm test' },
          liveOutput: {
            preview: '',
            stderr: 'warning: cached',
            stdout: 'line 1\nline 2\nline 3\nline 4\nline 5\n12 tests passed'
          }
        }}
      />
    )

    const note = screen.getByText('+2 earlier lines')
    expect(note.parentElement).toHaveTextContent('line 3')
    expect(note.parentElement).toHaveTextContent('12 tests passed')
    expect(note.parentElement).toHaveTextContent('warning: cached')
    expect(note.parentElement).not.toHaveTextContent('line 1')
    expect(screen.queryByRole('log')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Bash pnpm test Live output' }))
    const output = screen
      .getAllByTestId('code-block')
      .find((block) => block.getAttribute('data-state') === 'streaming')
    expect(output).toHaveAttribute('data-state', 'streaming')
    expect(screen.getAllByText('12 tests passed').length).toBeGreaterThan(0)
    expect(screen.getByText('Standard error')).toBeVisible()
    expect(screen.getByText('warning: cached')).toBeVisible()
    expect(screen.getAllByRole('log')).toHaveLength(1)
  })

  it('user waits for a long command when output streams, then sees elapsed time and line volume', async () => {
    vi.useFakeTimers()
    const { container } = render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'bash-progress-1',
          toolName: 'Bash',
          state: 'input-available',
          input: { command: 'cargo test' },
          liveOutput: { preview: '', stderr: '', stdout: 'checking\nrunning tests' }
        }}
      />
    )

    await act(() => vi.advanceTimersByTimeAsync(2_100))

    expect(container.querySelector('.agent-activity__result-meta')).toHaveTextContent(
      '2 lines · 2s'
    )
  })

  it('user expands search results when paths are returned, then the list has no code line numbers', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'glob-1',
          toolName: 'Glob',
          state: 'output-available',
          input: { pattern: '**/*.ts' },
          output: 'Found 2 file(s).\nsrc/a.ts\nsrc/b.ts'
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Glob **/*.ts Found 2 file(s).' }))
    const results = screen.getByRole('log', { name: 'Search results' })
    expect(results).toHaveTextContent('src/a.ts')
    expect(within(results).queryByText('1')).not.toBeInTheDocument()
    expect(within(results).queryByText('Found 2 file(s).')).not.toBeInTheDocument()
  })

  it('user sees a write stay compact when running, then its content stays hidden', () => {
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

    expect(screen.getByText('Writing file…')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('Preparing file')).not.toBeInTheDocument()
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

  it('user sees a compact path when a file tool runs, then assistive text retains the full path', () => {
    const fullPath =
      '/Users/delkon/Library/Application Support/Mico/workspaces/default/quicksort-demo/src/lib.rs'
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolCallId: 'absolute-read-running',
          toolName: 'Read',
          state: 'input-available',
          input: { file_path: fullPath }
        }}
      />
    )

    expect(screen.getByRole('group', { name: `Read ${fullPath} Reading file…` })).toBeVisible()
    expect(screen.getByTitle(fullPath)).toHaveTextContent('(…/quicksort-demo/src/lib.rs)')
  })

  it('user sees a completed read counted in lines when collapsed, then expanding reveals highlighted contents', async () => {
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
    await expect
      .poll(
        () =>
          screen.getByRole('log', { name: 'File content' }).querySelectorAll('[data-code-token]')
            .length
      )
      .toBeGreaterThan(0)
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

    expect(screen.getByRole('button', { name: 'Bash pnpm test Output available' })).toHaveAttribute(
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
  it('user revisits consecutive thoughts when a step has settled, then sees one reasoning disclosure', () => {
    render(
      <AgentActivityTimeline
        id="reasoning-group"
        isStreaming={false}
        parts={[
          { type: 'reasoning', text: 'First, inspect the partition.' },
          { type: 'reasoning', text: 'Then, verify the pivot choice.' }
        ]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Agent activity: Reasoning finished' }))
    const reasoning = screen.getByRole('button', { name: 'Reasoning · 2 steps' })
    expect(screen.queryByRole('button', { name: 'Thought' })).not.toBeInTheDocument()
    fireEvent.click(reasoning)
    expect(screen.getByText(/First, inspect the partition/)).toBeVisible()
    expect(screen.getByText(/Then, verify the pivot choice/)).toBeVisible()
  })

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

  it('user leaves a live step untouched when it settles, then the completed history becomes compact', () => {
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
    expect(screen.getByRole('status')).toHaveTextContent('Read 1 file')
    expect(screen.getByRole('button', { name: 'Agent activity: Read 1 file' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('user reopens a live step when inspecting it, then settling preserves that choice', () => {
    const tool = {
      type: 'dynamic-tool' as const,
      toolCallId: 'bash-inspected',
      toolName: 'Bash',
      state: 'input-available' as const,
      input: { command: 'pnpm test' }
    }
    const { rerender } = render(<AgentActivityTimeline id="inspected" isStreaming parts={[tool]} />)
    const liveHeader = screen.getByRole('button', { name: 'Agent activity: Running pnpm test' })

    fireEvent.click(liveHeader)
    fireEvent.click(liveHeader)
    rerender(
      <AgentActivityTimeline
        id="inspected"
        isStreaming={false}
        parts={[{ ...tool, state: 'output-available', output: 'Tests passed' }]}
      />
    )

    expect(screen.getByRole('button', { name: 'Agent activity: Ran 1 command' })).toHaveAttribute(
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

    const activity = screen.getByRole('button', {
      name: 'Agent activity: Read 1 file · Ran 1 command'
    })
    expect(activity).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(activity)

    expect(screen.getByText('Read 1 line.')).toBeVisible()
    const run = screen.getByRole('button', { name: 'Bash pnpm test Output available' })
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

    const activity = screen.getByRole('button', { name: 'Agent activity: Read 2 files' })
    fireEvent.click(activity)

    const group = screen.getByRole('button', { name: 'Read 2 files' })
    expect(group).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('b.ts')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Read a.ts Read 1 line.' })).not.toBeInTheDocument()

    fireEvent.click(group)

    // The group is the only disclosure; individual reads do not add a third level.
    expect(screen.getByText('Read 1 line.')).toBeVisible()
    expect(screen.getByText('Read 2 lines.')).toBeVisible()
    expect(screen.getByText('(a.ts)')).toBeVisible()
    expect(screen.getByText('(b.ts)')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Read a.ts Read 1 line.' })).not.toBeInTheDocument()
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

  it('user sees interrupted consecutive reads when generation stops, then the group makes no success claim', () => {
    render(
      <AgentActivityTimeline
        id="interrupted-reads"
        isStreaming={false}
        parts={[
          {
            type: 'dynamic-tool',
            toolCallId: 'read-interrupted-a',
            toolName: 'Read',
            state: 'input-available',
            input: { file_path: 'a.ts' }
          },
          {
            type: 'dynamic-tool',
            toolCallId: 'read-interrupted-b',
            toolName: 'Read',
            state: 'input-available',
            input: { file_path: 'b.ts' }
          }
        ]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Agent activity: 2 tools not completed' }))
    expect(screen.getByRole('button', { name: '2 file reads · 2 not completed' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Read 2 files' })).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Agent activity: Read 1 file' })).toHaveAttribute(
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
    expect(screen.getByRole('button', { name: 'Bash pnpm test Output available' })).toHaveAttribute(
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
    fireEvent.click(screen.getByRole('button', { name: 'Agent activity: 1 tool failed' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Agent activity: 1 tool not completed' }))
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
  it('user opens a multiline command when output is pending, then the invocation stays compact', () => {
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
    expect(screen.queryByText(/printf finished/)).not.toBeInTheDocument()
    expect(screen.getByText('Waiting for output…')).toBeVisible()
  })

  it('user sees an unfinished write when generation stops, then only its status remains visible', () => {
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
    expect(screen.getByText('Not completed.')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('Preparing file')).not.toBeInTheDocument()
    expect(screen.queryByText('File written')).not.toBeInTheDocument()
  })

  it('user sees an unfinished edit when generation stops, then its proposal stays hidden', () => {
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
    expect(screen.getByText('Not completed.')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('Proposed change 1')).not.toBeInTheDocument()
    expect(screen.queryByText('Applying changes')).not.toBeInTheDocument()
  })
})
