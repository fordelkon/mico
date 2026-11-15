import type { ExtraProps } from 'streamdown'
import type { MouseEvent } from 'react'

type MarkdownElement = NonNullable<ExtraProps['node']>

// The default sanitizer prefixes IDs but leaves fragment URLs and ARIA ID
// references untouched. Work after sanitization, keeping a namespace per reply.
function scopeFootnotes(scope: string) {
  const targetId = (fragment: string): string => `${scope}-user-content-${fragment}`
  function visit(parent: Pick<MarkdownElement, 'children'>, inFootnotes: boolean): void {
    for (const node of parent.children) {
      if (node.type !== 'element') continue
      const props = node.properties
      const ref = props.dataFootnoteRef !== undefined
      if ((ref || inFootnotes) && props.id) {
        props.id = `${scope}-${props.id}`
        if (node.tagName === 'li') props.tabIndex = -1
      }
      if (ref || props.dataFootnoteBackref !== undefined) {
        const href = String(props.href ?? '')
        if (href.startsWith('#')) {
          props.href = `#${targetId(href.slice(1))}`
          delete props.target
        }
        if (ref) props.ariaDescribedBy = [targetId('footnote-label')]
      }
      visit(node, inFootnotes || props.dataFootnotes !== undefined)
    }
  }
  return (root: Pick<MarkdownElement, 'children'>): void => visit(root, false)
}

function followFootnote(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault()
  const link = event.currentTarget
  const fragment = link.hash.slice(1)
  const target = link.ownerDocument.getElementById(fragment)
  if (!target || !link.closest('.mico-markdown')?.contains(target)) return
  target.focus({ preventScroll: true })
  target.scrollIntoView({ block: 'start', behavior: 'instant' })
}

export { followFootnote, scopeFootnotes }
