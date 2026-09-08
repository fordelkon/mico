import { cjk } from '@streamdown/cjk'
import { Streamdown, type Components } from 'streamdown'
import * as React from 'react'

import 'katex/dist/katex.min.css'

import { ChatCodeBlock } from './chat-code-block'
import {
  createMarkdownMathParserCache,
  decodeMarkdownMath,
  prepareMarkdownMath,
  renderMarkdownMath
} from '../../utils/markdown-math-parser'

type ChatMarkdownProps = {
  isStreaming: boolean
  text: string
}

type MarkdownCodeProps = React.ComponentPropsWithoutRef<'code'> & { node?: unknown }
type ChatMarkdownCodeProps = MarkdownCodeProps & { isStreaming: boolean }

const FencedCodeContext = React.createContext(false)

function textFromChildren(children: React.ReactNode): string {
  return React.Children.toArray(children).map(String).join('')
}

const plugins = {
  cjk
}

function ChatMarkdownCode({
  children,
  className,
  isStreaming,
  node: _node,
  ...props
}: ChatMarkdownCodeProps): React.JSX.Element {
  const isFencedCode = React.useContext(FencedCodeContext)

  if (!isFencedCode) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    )
  }

  const language = className?.match(/language-([^\s]+)/)?.[1]

  return (
    <ChatCodeBlock
      code={textFromChildren(children).replace(/\n$/, '')}
      isStreaming={isStreaming}
      language={language}
    />
  )
}

function ChatMarkdown({ isStreaming, text }: ChatMarkdownProps): React.JSX.Element {
  const [cache] = React.useState(createMarkdownMathParserCache)
  const source = React.useMemo(() => prepareMarkdownMath(text, cache), [cache, text])
  const components = React.useMemo<Partial<Components>>(
    () => ({
      pre: ({ children }) => (
        <FencedCodeContext.Provider value>{children}</FencedCodeContext.Provider>
      ),
      a: ({ children, ...props }) => {
        const math = decodeMarkdownMath(textFromChildren(children))
        if (!math) return <a {...props}>{children}</a>

        return (
          <span
            className={math.display ? 'mico-math mico-math--display' : 'mico-math'}
            dangerouslySetInnerHTML={{ __html: renderMarkdownMath(math.formula, math.display) }}
          />
        )
      },
      code: (props) => <ChatMarkdownCode {...props} isStreaming={isStreaming} />
    }),
    [isStreaming]
  )

  return (
    <div className="chat-markdown" data-testid="answer-content">
      <Streamdown
        components={components}
        isAnimating={isStreaming}
        mode={isStreaming ? 'streaming' : 'static'}
        plugins={plugins}
        remend={{ katex: false }}
      >
        {source}
      </Streamdown>
    </div>
  )
}

export { ChatMarkdown }
