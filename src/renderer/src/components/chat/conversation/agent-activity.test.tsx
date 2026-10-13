import '@testing-library/jest-dom/vitest'

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentActivityTimeline, AgentLoadingIndicator } from './agent-activity'
import { ThinkingTrace } from './tools/thinking-trace'
import { ToolTrace } from './tools/tool-trace'

afterEach(() => {
  vi.useRealTimers()
})

describe('ThinkingTrace', () => {
  it('user follows a thought when it settles, then its excerpt appears and the full text remains expandable', () => {
    const text = 'Checking the file layout.\nThen inspect the output rendering.'
    const { rerender } = render(<ThinkingTrace id="excerpt" isStreaming text={text} />)
    expect(screen.getByRole('button', { name: 'Thinking' })).not.toHaveTextContent(
      'Checking the file layout.'
    )
    rerender(<ThinkingTrace id="excerpt" isStreaming={false} text={text} />)
    const trigger = screen.getByRole('button', { name: 'Thought' })
    expect(trigger).toHaveTextContent('Checking the file layout.')
    fireEvent.click(trigger)
    expect(screen.getByLabelText('Reasoning')).toHaveTextContent(
      'Then inspect the output rendering.'
    )
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })
  it('user sees compact reasoning when text streams, then details remain optional', () => {
    render(<ThinkingTrace id="reasoning-1" isStreaming text="Inspecting the request." />)

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
    render(<ThinkingTrace id="reasoning-1" isStreaming={false} text="Inspecting the request." />)

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
      <ThinkingTrace id="reasoning-1" isStreaming text="Inspecting the request." />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Thinking' }))
    fireEvent.click(screen.getByRole('button', { name: 'Thinking' }))

    rerender(
      <ThinkingTrace id="reasoning-1" isStreaming text="Inspecting the request. Reading files." />
    )

    expect(screen.getByRole('button', { name: 'Thinking' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    rerender(
      <ThinkingTrace
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

  it.each([
    {
      variant: 'live output streams',
      part: {
        type: 'dynamic-tool' as const,
        toolCallId: 'compact-stream',
        toolName: 'Bash',
        input: { command: 'pnpm test' },
        liveOutput: { preview: '', stdout: 'first line', stderr: '' }
      },
      initialTrigger: 'Bash pnpm test Live output',
      liveLogText: /first line/,
      finalOutput: 'first line\nlast line',
      finalLogText: 'last line'
    },
    {
      variant: 'no output has arrived yet',
      part: {
        type: 'dynamic-tool' as const,
        toolCallId: 'terminal',
        toolName: 'Bash',
        input: { command: 'pnpm test' }
      },
      initialTrigger: 'Bash pnpm test Running…',
      liveLogText: /Waiting for output…/,
      finalOutput: 'Tests passed',
      finalLogText: 'Tests passed'
    }
  ])(
    'user opens a running tool when $variant, then completion preserves the expanded detail',
    (fixture) => {
      const { rerender } = render(
        <ToolTrace part={{ ...fixture.part, state: 'input-available' }} />
      )
      const trigger = screen.getByRole('button', { name: fixture.initialTrigger })
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('log')).not.toBeInTheDocument()

      fireEvent.click(trigger)
      expect(screen.getByRole('log', { name: 'Terminal output' })).toHaveTextContent(
        fixture.liveLogText
      )

      rerender(
        <ToolTrace
          part={{
            type: fixture.part.type,
            toolCallId: fixture.part.toolCallId,
            toolName: fixture.part.toolName,
            input: fixture.part.input,
            state: 'output-available',
            output: fixture.finalOutput
          }}
        />
      )
      expect(
        screen.getByRole('button', { name: 'Bash pnpm test Output available' })
      ).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('log')).toHaveTextContent(fixture.finalLogText)
    }
  )

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
    render(
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

    const result = screen.getByText('Command exited with code 1').parentElement
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

  it('user expands a command when output has formatting controls, then sees clean text', () => {
    render(
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

    fireEvent.click(screen.getByRole('button', { name: /^Bash / }))
    const summary = screen.getByRole('log', { name: 'Terminal output' })
    expect(summary).toHaveTextContent('-error')
    expect(summary).toHaveTextContent('+formatted')
    expect(summary).not.toHaveTextContent('\u001b')
    expect(summary).not.toHaveTextContent('(B')
  })

  it('user views terminal hyperlinks when output contains OSC controls, then only the visible label remains', () => {
    render(
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

    fireEvent.click(screen.getByRole('button', { name: /^Bash / }))
    const summary = screen.getByRole('log', { name: 'Terminal output' })
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

  it('user expands a persisted command when output is restored, then its result is available', () => {
    render(
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
    fireEvent.click(screen.getByRole('button', { name: /^Bash / }))
    const summary = screen.getByRole('log', { name: 'Terminal output' })
    expect(summary).toHaveTextContent('cargo 1.95.0')
    expect(summary).toHaveTextContent('rustc 1.95.0')
  })

  it('user expands a running command when output arrives, then stdout and stderr are available', () => {
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

  it('user waits for a command when output streams, then elapsed time stays visible', async () => {
    vi.useFakeTimers()
    render(
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

    expect(screen.getByText('2s')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Bash cargo test Live output' })).toHaveAttribute(
      'aria-expanded',
      'false'
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
    expect(screen.getByRole('button', { name: 'Read src/index.ts Read 1 line.' })).toBeVisible()
  })

  it('user revisits a finished step when tools are present, then each tool is directly expandable', () => {
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

    expect(screen.queryByRole('button', { name: /^Agent activity:/ })).not.toBeInTheDocument()

    expect(screen.getByText('Read 1 line.')).toBeVisible()
    const run = screen.getByRole('button', { name: 'Bash pnpm test Output available' })
    fireEvent.click(run)

    expect(run).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Output')).toBeVisible()
    expect(screen.getAllByText('Tests passed').length).toBeGreaterThan(0)
  })
})

describe('Read group collapsing', () => {
  it('user collapses consecutive reads into one group line when two arrive together, then expands to inspect each file', () => {
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

    const group = screen.getByRole('button', { name: 'Read 2 files' })
    expect(group).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Read a.ts Read 1 line.' })).not.toBeInTheDocument()

    fireEvent.click(group)

    expect(screen.getByText('Read 1 line.')).toBeVisible()
    expect(screen.getByText('Read 2 lines.')).toBeVisible()
    expect(screen.getByText('(a.ts)')).toBeVisible()
    expect(screen.getByText('(b.ts)')).toBeVisible()
    // Each read keeps its own row disclosure so the file content stays inspectable.
    fireEvent.click(screen.getByRole('button', { name: 'Read a.ts Read 1 line.' }))
    expect(screen.getByRole('log', { name: 'File content' })).toHaveTextContent('one')
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

    expect(screen.getByRole('button', { name: '2 file reads · 2 interrupted' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Read 2 files' })).not.toBeInTheDocument()
  })

  it('user sees an approval called out when a grouped read waits for permission, then the group names the wait', () => {
    render(
      <AgentActivityTimeline
        id="group-approval"
        isStreaming
        parts={[
          {
            type: 'dynamic-tool',
            toolCallId: 'read-approved',
            toolName: 'Read',
            state: 'output-available',
            input: { file_path: 'a.ts' },
            output: 'one'
          },
          {
            type: 'dynamic-tool',
            toolCallId: 'read-awaiting',
            toolName: 'Read',
            state: 'input-available',
            input: { file_path: 'b.ts' },
            permission: {
              approvalId: '00000000-0000-4000-8000-000000000002',
              toolCallId: 'read-awaiting',
              toolName: 'Read',
              cwd: '/workspace',
              input: { file_path: 'b.ts' },
              reason: 'This file read runs on your computer.',
              state: 'pending'
            }
          }
        ]}
      />
    )

    expect(screen.getByRole('button', { name: '2 file reads · 1 awaiting approval' })).toBeVisible()
  })
})

describe('Activity disclosure and outcomes', () => {
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
    expect(screen.getByRole('button', { name: 'Bash pnpm test Interrupted' })).toBeVisible()
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
    expect(screen.getByRole('button', { name: 'Reading 2 files…' })).toBeVisible()
  })
})

describe('Unfinished tool details', () => {
  it('user opens a multiline command when output is pending, then the full command is available', () => {
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
    expect(screen.getByLabelText('Command')).toHaveTextContent('printf finished')
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
    expect(screen.getByText('Interrupted')).toBeVisible()
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
    expect(screen.getByText('Interrupted')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('Proposed change 1')).not.toBeInTheDocument()
    expect(screen.queryByText('Applying changes')).not.toBeInTheDocument()
  })

  it('user sees an interrupted status when generation stops before a search result, then success is not claimed', () => {
    render(
      <ToolTrace
        isActive={false}
        part={{
          type: 'dynamic-tool',
          toolName: 'Glob',
          toolCallId: 'glob-stopped',
          state: 'input-available',
          input: { pattern: '**/*.ts' }
        }}
      />
    )
    expect(screen.getByRole('group', { name: 'Glob **/*.ts Interrupted' })).toBeVisible()
    expect(screen.queryByText('Search completed.')).not.toBeInTheDocument()
  })
})

describe('Tool row status words and failure disclosure', () => {
  it('user opens a failed command without clicking when it fails, then a manual collapse survives updates', () => {
    const part = {
      type: 'dynamic-tool' as const,
      toolName: 'Bash',
      toolCallId: 'failed-expand-1',
      state: 'output-error' as const,
      input: { command: 'cargo test' },
      errorText: 'Command exited with code 1'
    }
    const { rerender } = render(<ToolTrace part={part} />)

    const trigger = screen.getByRole('button', {
      name: 'Bash cargo test Command exited with code 1'
    })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Command')).toBeVisible()

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    rerender(<ToolTrace part={part} />)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('user reads a failed file tool row when the run fails, then Failed is stated in words', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolName: 'Edit',
          toolCallId: 'edit-fail-word',
          state: 'output-error',
          input: { file_path: 'index.ts', old_string: 'old', new_string: 'new' },
          errorText: 'Could not edit index.ts.'
        }}
      />
    )

    expect(
      screen.getByRole('group', { name: 'Update index.ts Failed Could not edit index.ts.' })
    ).toBeVisible()
  })

  it('user sees an approval status when a tool row waits for permission, then the state is announced once', () => {
    render(
      <ToolTrace
        part={{
          type: 'dynamic-tool',
          toolName: 'Write',
          toolCallId: 'await-approval-1',
          state: 'input-available',
          input: { file_path: 'src/index.ts', content: 'export {}' },
          permission: {
            approvalId: '00000000-0000-4000-8000-000000000001',
            toolCallId: 'await-approval-1',
            toolName: 'Write',
            cwd: '/workspace',
            input: { file_path: 'src/index.ts' },
            reason: 'This file write runs on your computer.',
            state: 'pending'
          }
        }}
      />
    )

    expect(
      screen.getByRole('group', { name: 'Write src/index.ts Awaiting approval' })
    ).toBeVisible()
    expect(screen.queryByText('Waiting for your approval.')).not.toBeInTheDocument()
  })

  it('user keeps a running command compact when output streams, then a failure opens it without a click', () => {
    const part = {
      type: 'dynamic-tool' as const,
      toolName: 'Bash',
      toolCallId: 'run-then-fail-1',
      input: { command: 'cargo build' }
    }
    const { rerender } = render(<ToolTrace part={{ ...part, state: 'input-available' }} />)

    expect(screen.getByRole('button', { name: 'Bash cargo build Running…' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )

    rerender(
      <ToolTrace part={{ ...part, state: 'output-error' as const, errorText: 'Build failed' }} />
    )
    expect(screen.getByRole('button', { name: 'Bash cargo build Build failed' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })
})
