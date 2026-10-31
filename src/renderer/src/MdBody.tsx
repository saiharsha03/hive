// A rendered markdown message with clean copies for Teams / Outlook / Word / Excel / plain boxes: a Copy button for the whole
// message (rich HTML + the original markdown), one per table (HTML + TSV) and one per code block (just the code), and Ctrl+C
// on a selection in the conversation gives light HTML instead of Chromium's copy with the dark theme's colors inline.
import { useRef, useState, type ComponentProps } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cleanHtml, tableTsv, textOf, wrapSelection, type CNode } from '../../shared/copyCore'

// the rendered DOM as a small tree; our own buttons are left out
function treeOf(n: Node): CNode | null {
  if (n.nodeType === Node.TEXT_NODE) return { type: 'text', value: n.nodeValue ?? '' }
  if (n.nodeType !== Node.ELEMENT_NODE) return null
  const el = n as HTMLElement
  if (el.hasAttribute('data-nocopy')) return null
  const properties: Record<string, unknown> = {}
  const href = el.getAttribute('href')
  if (href) properties.href = href
  const align = el.style?.textAlign || el.getAttribute('align')
  if (align) properties.align = align
  if (el instanceof HTMLInputElement) { properties.type = el.type; properties.checked = el.checked }
  return { type: 'element', tagName: el.tagName.toLowerCase(), properties, children: kids(el) }
}
const kids = (n: Node): CNode[] => [...n.childNodes].map(treeOf).filter((c): c is CNode => c !== null)

async function write(html: string, plain: string): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({
    'text/html': new Blob([html], { type: 'text/html' }),
    'text/plain': new Blob([plain], { type: 'text/plain' }),
  })])
}

function CopyButton({ className, title, onCopy }: { className: string; title: string; onCopy: () => Promise<void> }) {
  const [done, setDone] = useState<'' | 'Copied' | 'Failed'>('')
  const click = () => {
    onCopy().then(() => setDone('Copied'), () => setDone('Failed'))
    setTimeout(() => setDone(''), 1200)
  }
  return <button data-testid={`copy-${className}`} data-nocopy className={`mdcopy ${className}`} title={title} onClick={click}>{done || 'Copy'}</button>
}

function TableBox(props: ComponentProps<'table'>) {
  const ref = useRef<HTMLTableElement>(null)
  const copy = async () => {
    const t = ref.current && treeOf(ref.current)
    if (t) await write(cleanHtml([t]), tableTsv(t))
  }
  return (
    <div className="mdtable">
      <CopyButton className="tcopy" title="Copy the table (pastes as cells in Excel, as a table in Teams / Outlook)" onCopy={copy} />
      <table ref={ref} {...props} />
    </div>
  )
}

function CodeBox(props: ComponentProps<'pre'>) {
  const ref = useRef<HTMLPreElement>(null)
  const copy = () => navigator.clipboard.writeText((ref.current?.textContent ?? '').replace(/\n$/, ''))
  return (
    <div className="mdpre">
      <CopyButton className="pcopy" title="Copy the code" onCopy={copy} />
      <pre ref={ref} {...props} />
    </div>
  )
}

const COMPONENTS = {
  table: ({ node: _n, ...p }: ComponentProps<'table'> & { node?: unknown }) => <TableBox {...p} />,
  pre: ({ node: _n, ...p }: ComponentProps<'pre'> & { node?: unknown }) => <CodeBox {...p} />,
}

export function MdBody({ text, copy = true }: { text: string; copy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const copyAll = async () => { if (ref.current) await write(cleanHtml(kids(ref.current)), text) }
  return (
    <div className="mdmsg">
      {copy && <CopyButton className="msgcopy" title="Copy the message (formatted for Teams / Outlook / Word, markdown for plain text)" onCopy={copyAll} />}
      <div className="body md" ref={ref}><Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>{text}</Markdown></div>
    </div>
  )
}

// Ctrl+C on a selection in the conversation: light HTML of just the selection, plus its plain text
document.addEventListener('copy', (e) => {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !e.clipboardData) return
  const range = sel.getRangeAt(0)
  const common = range.commonAncestorContainer
  const start = common.nodeType === Node.ELEMENT_NODE ? common as Element : common.parentElement
  const root = start?.closest('.thread')
  if (!start || !root || start.closest('textarea, input')) return
  const ancestors: string[] = []
  for (let el: Element | null = start; el && el !== root; el = el.parentElement) ancestors.push(el.tagName.toLowerCase())
  const nodes = wrapSelection(kids(range.cloneContents()), ancestors)
  const plain = sel.toString() || nodes.map(textOf).join('')
  e.clipboardData.setData('text/html', cleanHtml(nodes))
  e.clipboardData.setData('text/plain', plain)
  e.preventDefault()
})
