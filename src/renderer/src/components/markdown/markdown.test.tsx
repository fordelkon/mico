import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Markdown } from './markdown'

function queryCodeBlock(): Element | null {
  return document.querySelector('[data-slot="code-block"]')
}

describe('Markdown', () => {
  it('user reads the streamed answer with a caret when text streams, then no per-word wrappers bloat it', () => {
    const { container: answer } = render(<Markdown isStreaming text="The answer is arriving." />)

    expect(answer).toHaveTextContent('The answer is arriving.')
    // SAFETY: per-word animation wrappers only exist as streamdown markers, but retaining one wrapper
    // per streamed word can exhaust renderer memory, so their absence is guarded at this seam.
    expect(answer.querySelectorAll('[data-sd-animate]')).toHaveLength(0)
    // SAFETY: jsdom runs no CSS animations, so the inline caret variable is the only handle for the visible caret.
    expect(answer.querySelector('[style*="--streamdown-caret"]')).toHaveStyle({
      '--streamdown-caret': '" ●"'
    })
  })

  it('user sees unlabelled fenced blocks as numbered cards when rendering, then blank lines survive', () => {
    render(<Markdown isStreaming={false} text={'```\nconst answer = 42\n\n```'} />)

    const codeBlock = queryCodeBlock()

    expect(codeBlock).toHaveTextContent('const answer = 42')
    expect(codeBlock).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeVisible()
    // The preserved blank line renders as a second numbered line in the gutter.
    expect(screen.getByText('2')).toBeVisible()
  })

  it('user sees an unfinished fenced block marked streaming when open, then the source renders', () => {
    render(<Markdown isStreaming text={'```ts\nconst draft ='} />)

    const codeBlock = queryCodeBlock()

    expect(codeBlock).toHaveAttribute('data-state', 'streaming')
    expect(screen.getByRole('log')).toHaveTextContent('const draft =')
  })

  it('user sees inline code stay plain when backticks are used, then no card wraps it', () => {
    render(<Markdown isStreaming={false} text={'Use `const answer = 42` inline.'} />)

    expect(queryCodeBlock()).toBeNull()
    expect(screen.getByText('const answer = 42').closest('code')).toBeInTheDocument()
  })

  it('user reads two referenced snippets when the last fence is open, then only that snippet is writing', () => {
    const text = [
      'See [guide][doc].',
      '[doc]: https://example.org',
      '~~~~js\nconst done = 1\n~~~~',
      '```js\nconst live ='
    ].join('\n\n')
    const { rerender } = render(<Markdown isStreaming text={text} />)
    expect(screen.getAllByTestId('code-block').map((block) => block.dataset.state)).toEqual([
      'complete',
      'streaming'
    ])
    rerender(<Markdown isStreaming text={text + ' 2\n```'} />)
    expect(screen.getAllByText('Ready')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'guide' })).toHaveAttribute(
      'href',
      'https://example.org/'
    )
  })

  it('user reads a closed fence when more prose streams, then its copy control keeps focus through completion', () => {
    const code = '```ts\nconst first = 1\n'
    const { rerender } = render(<Markdown isStreaming text={code} />)
    const copy = screen.getByRole('button', { name: 'Copy code' })
    copy.focus()
    const final = code + '```\n\nThe first value is ready.'
    rerender(<Markdown isStreaming text={final} />)
    expect(screen.getByText('Ready')).toBeVisible()
    rerender(<Markdown isStreaming={false} text={final} />)
    expect(copy).toHaveFocus()
    expect(screen.getByText('The first value is ready.')).toBeVisible()
  })

  it('user sees math delimiters stay literal when they appear inside code, then no math renders', () => {
    render(<Markdown isStreaming={false} text={'`$x^2$`\n\n```tex\n$$x$$\n```'} />)

    expect(document.querySelector('.katex')).toBeNull()
    expect(screen.getByText('$x^2$').closest('code')).toBeInTheDocument()
    expect(queryCodeBlock()).toHaveTextContent('$$x$$')
  })
})
