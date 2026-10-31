import { test } from 'vitest'
import assert from 'node:assert/strict'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { toHast } from 'mdast-util-to-hast'
import { cleanHtml, tableTsv, textOf, wrapSelection, type CNode } from '../../src/shared/copyCore'

// markdown -> the same hast react-markdown renders from (remark-gfm + remark-rehype)
const tree = (md: string): CNode[] => (toHast(fromMarkdown(md, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })) as any).children
const find = (ns: CNode[], tag: string): any => {
  for (const n of ns) if (n.type === 'element') { if (n.tagName === tag) return n; const f = find(n.children, tag); if (f) return f }
}

const TABLE = [String.raw`| Name | Note | Qty |`, '|:--|:--|--:|', String.raw`| a \| b | **bold** and ${'`'}x\|y${'`'} | 3 |`, '| say "hi" | [link](https://example.com) | 10 |', ''].join(String.fromCharCode(10))

test('table with pipes in cells -> TSV keeps the pipe inside one cell', () => {
  const t = find(tree(TABLE), 'table')
  assert.equal(tableTsv(t), 'Name\tNote\tQty\na | b\tbold and x|y\t3\n"say ""hi"""\tlink\t10')
})

test('table -> HTML is a real bordered table, alignment kept, no classes or dark colors', () => {
  const h = cleanHtml(tree(TABLE))
  assert.match(h, /<table style="border-collapse:collapse[^"]*"><thead><tr><th style="[^"]*text-align:left">Name<\/th>/)
  assert.match(h, /<td style="[^"]*text-align:right">3<\/td>/)
  assert.match(h, /<td style="[^"]*">a \| b<\/td>/)
  assert.match(h, /<b>bold<\/b> and <code style="font-family:Consolas[^"]*">x\|y<\/code>/)
  assert.match(h, /<a href="https:\/\/example.com">link<\/a>/)
  assert.doesNotMatch(h, /class=|background|#1f1f1f|#cccccc|\n/)
})

test('bold, italics, lists, nested list, links', () => {
  const h = cleanHtml(tree('Some **bold** and *it*.\n\n- one\n- two [x](https://x.io)\n  1. inner\n\n1. first\n'))
  assert.match(h, /<p style="[^"]*">Some <b>bold<\/b> and <i>it<\/i>\.<\/p>/)
  assert.match(h, /<ul style="[^"]*"><li>one<\/li><li>two <a href="https:\/\/x.io">x<\/a><ol style="[^"]*"><li>inner<\/li><\/ol><\/li><\/ul>/)
  assert.match(h, /<ol style="[^"]*"><li>first<\/li><\/ol>/)
})

test('code block -> monospace pre, newlines kept, HTML escaped', () => {
  const h = cleanHtml(tree('```ts\nconst a = 1 < 2\n\nlet b = "<b>"\n```\n'))
  assert.match(h, /<pre style="font-family:Consolas[^"]*white-space:pre-wrap[^"]*"><code>const a = 1 &lt; 2\n\nlet b = "&lt;b&gt;"\n<\/code><\/pre>/)
})

test('unsafe or relative links paste as text; unknown tags unwrap; buttons dropped', () => {
  const h = cleanHtml([
    { type: 'element', tagName: 'a', properties: { href: 'javascript:alert(1)' }, children: [{ type: 'text', value: 'bad' }] },
    { type: 'element', tagName: 'span', properties: { style: 'color:#ccc' }, children: [{ type: 'text', value: ' ok' }] },
    { type: 'element', tagName: 'button', children: [{ type: 'text', value: 'Copy' }] },
  ])
  assert.equal(h, `<div style="font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:14px;color:#000000">bad ok</div>`)
})

test('task list checkboxes', () => {
  const ns = tree('- [x] done\n- [ ] todo\n')
  assert.match(cleanHtml(ns), /<li>&#9745; done<\/li><li>&#9744; todo<\/li>/)
  assert.match(textOf(find(ns, 'ul')), /\[x\] done/)
})

test('partial selection wrappers', () => {
  const td = (v: string): CNode => ({ type: 'element', tagName: 'td', children: [{ type: 'text', value: v }] })
  const tr: CNode = { type: 'element', tagName: 'tr', children: [td('1'), td('2')] }
  // two rows selected: common ancestor tbody -> wrapped back into a table
  const rows = wrapSelection([tr, tr], ['tbody', 'table', 'div', 'div'])
  assert.match(cleanHtml(rows), /^<div[^>]*><table[^>]*><tbody><tr><td/)
  assert.equal(tableTsv(rows[0]), '1\t2\n1\t2')
  // a few words inside one cell stay inline
  assert.match(cleanHtml(wrapSelection([{ type: 'text', value: 'wo' }], ['td', 'tr', 'tbody', 'table'])), /^<div[^>]*>wo<\/div>$/)
  // text inside a code block stays code
  assert.match(cleanHtml(wrapSelection([{ type: 'text', value: 'x' }], ['code', 'pre', 'div'])), /<pre[^>]*><code>x<\/code><\/pre>/)
})
