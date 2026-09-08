import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ChatMarkdown } from './chat-markdown'

describe('ChatMarkdown', () => {
  it('shows the streaming caret without retaining per-word animation nodes', () => {
    render(<ChatMarkdown isStreaming text="The answer is arriving." />)

    const answer = screen.getByTestId('answer-content')

    expect(answer.querySelectorAll('[data-sd-animate]')).toHaveLength(0)
    expect(answer.querySelector('[style*="--streamdown-caret"]')).toHaveStyle({
      '--streamdown-caret': '" ●"'
    })
  })

  it('renders an unlabelled fenced block as a line-numbered code card and preserves its blank line', () => {
    render(<ChatMarkdown isStreaming={false} text={'```\nconst answer = 42\n\n```'} />)

    const codeBlock = screen.getByTestId('code-block')
    const codeRows = codeBlock.querySelectorAll('.chat-code-block__body code')

    expect(codeBlock).toHaveTextContent('const answer = 42')
    expect(codeBlock).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeVisible()
    expect(codeRows).toHaveLength(2)
    expect(codeRows[1]?.textContent).toBe(' ')
  })

  it('keeps inline code outside the code-card renderer', () => {
    render(<ChatMarkdown isStreaming={false} text={'Use `const answer = 42` inline.'} />)

    expect(screen.queryByTestId('code-block')).toBeNull()
    expect(screen.getByText('const answer = 42').closest('code')).toBeInTheDocument()
  })

  it('leaves math delimiters in inline and fenced code literal', () => {
    render(<ChatMarkdown isStreaming={false} text={'`$x^2$`\n\n```tex\n$$x$$\n```'} />)

    expect(document.querySelector('.katex')).toBeNull()
    expect(screen.getByText('$x^2$').closest('code')).toBeInTheDocument()
    expect(screen.getByTestId('code-block')).toHaveTextContent('$$x$$')
  })
})
