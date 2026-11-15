import { cjk } from '@streamdown/cjk'
import * as React from 'react'
import {
  Block,
  type BlockProps,
  type Components,
  defaultRehypePlugins,
  type ExtraProps,
  parseMarkdownIntoBlocks,
  Streamdown
} from 'streamdown'

import 'katex/dist/katex.min.css'
import 'streamdown/styles.css'
import './markdown.css'

import { ChatCodeBlock } from './chat-code-block'
import { followFootnote, scopeFootnotes } from './markdown-footnotes'
import {
  createMarkdownMathParserCache,
  decodeMarkdownMath,
  prepareMarkdownMath,
  renderMarkdownMath
} from './markdown-math-parser'

type MarkdownProps = {
  isStreaming: boolean
  text: string
}

type MarkdownCodeProps = React.ComponentPropsWithoutRef<'code'> & ExtraProps

const FencedCodeContext = React.createContext(false)
const OpenFenceEnd = React.createContext<number | null>(null)

function MarkdownBlock(props: BlockProps): React.JSX.Element {
  // Reference definitions keep several Markdown nodes in one parser block.
  // Only the code node reaching its unfinished tail can still receive text.
  const end = props.isIncomplete ? props.content.trimEnd().length : null
  return (
    <OpenFenceEnd.Provider value={end}>
      <Block {...props} />
    </OpenFenceEnd.Provider>
  )
}

function textFromChildren(children: React.ReactNode): string {
  return React.Children.toArray(children).map(String).join('')
}

const plugins = {
  cjk
}

function MarkdownCode({
  children,
  className,
  node,
  ...props
}: MarkdownCodeProps): React.JSX.Element {
  const isFencedCode = React.useContext(FencedCodeContext)
  const end = React.useContext(OpenFenceEnd)
  const isStreaming = end !== null && (node?.position?.end.offset ?? -1) >= end

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

const components: Partial<Components> = {
  pre: ({ children }) => <FencedCodeContext.Provider value>{children}</FencedCodeContext.Provider>,
  a: ({ children, node, ...props }) => {
    if (
      props.href?.startsWith('#') &&
      (node?.properties.dataFootnoteRef !== undefined ||
        node?.properties.dataFootnoteBackref !== undefined)
    ) {
      return (
        <a {...props} onClick={followFootnote} onAuxClick={(event) => event.preventDefault()}>
          {children}
        </a>
      )
    }
    const math = decodeMarkdownMath(textFromChildren(children))
    if (!math) return <a {...props}>{children}</a>

    return (
      <span
        className={math.display ? 'mico-math mico-math--display' : 'mico-math'}
        dangerouslySetInnerHTML={{ __html: renderMarkdownMath(math.formula, math.display) }}
      />
    )
  },
  code: MarkdownCode
}

// Reference definitions can resolve links in earlier paragraphs. In that case
// the Markdown parser needs the full document, including after streaming ends.
function splitMarkdown(source: string): string[] {
  return source.includes(']:') ? [source] : parseMarkdownIntoBlocks(source)
}

function Markdown({ isStreaming, text }: MarkdownProps): React.JSX.Element {
  const [cache] = React.useState(createMarkdownMathParserCache)
  const source = React.useMemo(() => prepareMarkdownMath(text, cache), [cache, text])
  const [startedLive] = React.useState(isStreaming)
  const scope = React.useId()
  const notePlugins = React.useMemo<NonNullable<BlockProps['rehypePlugins']>>(
    () => [...Object.values(defaultRehypePlugins), [scopeFootnotes, scope]],
    [scope]
  )

  return (
    <div className="mico-markdown">
      {/* Per-word animation retains a wrapper for every streamed word and can exhaust renderer memory. */}
      <Streamdown
        BlockComponent={MarkdownBlock}
        caret="circle"
        components={components}
        isAnimating={isStreaming}
        mode={startedLive || isStreaming ? 'streaming' : 'static'}
        parseIncompleteMarkdown={isStreaming}
        parseMarkdownIntoBlocksFn={splitMarkdown}
        plugins={plugins}
        rehypePlugins={source.includes('[^') ? notePlugins : undefined}
        remend={{ katex: false }}
      >
        {source}
      </Streamdown>
    </div>
  )
}

export { Markdown }
