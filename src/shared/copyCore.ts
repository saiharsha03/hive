// Clean copies of rendered markdown for pasting into Teams, Outlook, Word, Excel or a plain text box: a small element tree (the
// shape of a hast tree, which the rendered DOM is converted to) becomes light, inline-styled HTML, and a table becomes TSV.
// No DOM, no React, so it can be tested in node.

export type CNode = CText | CElement
export type CText = { type: 'text'; value: string }
export type CElement = { type: 'element'; tagName: string; properties?: Record<string, unknown>; children: CNode[] }

const MONO = "font-family:Consolas,'Courier New',monospace"
const CELL = 'border:1px solid #999999;padding:4px 8px;vertical-align:top'
// tag kept (renamed where the target apps prefer the old form) and its inline style; anything else is unwrapped
const KEEP: Record<string, [string, string]> = {
  p: ['p', 'margin:0 0 8px 0'], br: ['br', ''], hr: ['hr', ''],
  strong: ['b', ''], b: ['b', ''], em: ['i', ''], i: ['i', ''], del: ['s', ''], s: ['s', ''],
  code: ['code', MONO], pre: ['pre', `${MONO};white-space:pre-wrap;margin:0 0 8px 0`],
  ul: ['ul', 'margin:0 0 8px 0'], ol: ['ol', 'margin:0 0 8px 0'], li: ['li', ''],
  h1: ['h1', 'font-size:18px;margin:12px 0 6px 0'], h2: ['h2', 'font-size:16px;margin:12px 0 6px 0'],
  h3: ['h3', 'font-size:14px;margin:12px 0 6px 0'], h4: ['h4', 'font-size:14px;margin:12px 0 6px 0'],
  h5: ['h5', 'font-size:14px;margin:12px 0 6px 0'], h6: ['h6', 'font-size:14px;margin:12px 0 6px 0'],
  blockquote: ['blockquote', 'margin:0 0 8px 0;padding-left:10px;border-left:3px solid #cccccc;color:#555555'],
  table: ['table', 'border-collapse:collapse;margin:0 0 8px 0'], thead: ['thead', ''], tbody: ['tbody', ''], tr: ['tr', ''],
  th: ['th', `${CELL};font-weight:bold;text-align:left`], td: ['td', `${CELL};text-align:left`],
  a: ['a', ''],
}
const SKIP = new Set(['button', 'script', 'style', 'svg'])
const SAFE_URL = /^(https?:|mailto:)/i

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const attr = (s: string) => esc(s).replace(/"/g, '&quot;')
const prop = (el: CElement, k: string) => el.properties?.[k]

// text of a subtree, as it reads on screen
export function textOf(n: CNode): string {
  if (n.type === 'text') return n.value
  if (SKIP.has(n.tagName)) return ''
  if (n.tagName === 'br') return '\n'
  if (n.tagName === 'input') return prop(n, 'checked') ? '[x]' : '[ ]'
  return n.children.map(textOf).join('')
}

function html(n: CNode, inPre: boolean): string {
  if (n.type === 'text') return esc(n.value)
  const tag = n.tagName
  if (SKIP.has(tag) || prop(n, 'nocopy')) return ''
  if (tag === 'input') return prop(n, 'type') === 'checkbox' ? (prop(n, 'checked') ? '&#9745;' : '&#9744;') : ''
  const pre = inPre || tag === 'pre'
  const inner = n.children.map((c) => html(c, pre)).join('')
  const keep = KEEP[tag]
  if (!keep) return inner
  const [out, base] = keep
  if (out === 'br' || out === 'hr') return `<${out}>`
  let style = base
  if (out === 'code' && inPre) style = '' // the pre already sets the font
  const align = prop(n, 'align')
  if ((out === 'th' || out === 'td') && typeof align === 'string' && /^(left|right|center)$/.test(align)) style = style.replace('text-align:left', `text-align:${align}`)
  let attrs = style ? ` style="${style}"` : ''
  if (out === 'a') {
    const href = prop(n, 'href')
    if (typeof href !== 'string' || !SAFE_URL.test(href)) return inner // a relative or script link pastes as its text
    attrs = ` href="${attr(href)}"`
  }
  return `<${out}${attrs}>${inner}</${out}>`
}

// the newline-only text nodes react-markdown leaves between blocks would paste as blank lines inside lists and tables
function squeeze(nodes: CNode[]): CNode[] {
  return nodes.filter((c) => !(c.type === 'text' && /^\n+$/.test(c.value))).map((c) => (c.type === 'element' && c.tagName !== 'pre' ? { ...c, children: squeeze(c.children) } : c))
}

// light HTML with inline styles only: no classes, no colors from the app's dark theme, links limited to http(s) and mailto
export function cleanHtml(nodes: CNode[]): string {
  const body = squeeze(nodes).map((n) => html(n, false)).join('')
  return `<div style="font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:14px;color:#000000">${body}</div>`
}

// structural wrappers a partial selection needs to stay valid: a few cells copied out of a table still paste as a table, a
// couple of list items as a list, code as code. `ancestors` are the tag names around the selection, innermost first.
const STRUCT = new Set(['table', 'thead', 'tbody', 'tr', 'ul', 'ol', 'pre', 'code'])
export function wrapSelection(nodes: CNode[], ancestors: string[]): CNode[] {
  const hasElement = nodes.some((n) => n.type === 'element')
  let out = nodes
  for (const tag of ancestors) {
    if (!STRUCT.has(tag)) continue
    if (!hasElement && tag !== 'pre' && tag !== 'code') continue // a few words out of one cell or item paste inline
    out = [{ type: 'element', tagName: tag, children: out }]
  }
  return out
}

function rowsOf(n: CNode, rows: CElement[] = []): CElement[] {
  if (n.type !== 'element') return rows
  if (n.tagName === 'tr') rows.push(n)
  else n.children.forEach((c) => rowsOf(c, rows))
  return rows
}

// one cell for Excel / Sheets: on one line, no tabs; quoted (quotes doubled) when it holds a quote, as Excel reads it
function tsvCell(n: CNode): string {
  const s = textOf(n).replace(/[\t\r\n]+/g, ' ').replace(/ {2,}/g, ' ').trim()
  return s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
}

// a table as TAB-separated rows, so a paste into Excel or Sheets lands in cells
export function tableTsv(table: CNode): string {
  return rowsOf(table)
    .map((tr) => tr.children.filter((c): c is CElement => c.type === 'element' && (c.tagName === 'td' || c.tagName === 'th')).map(tsvCell).join('\t'))
    .join('\n')
}
