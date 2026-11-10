// The new UI's pure parts: the layout migration from the old four layouts and five themes, the "since you looked"
// line and tool-row words, and the stores' selectors (a streaming reply must not change what the shell selects).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { DEFAULT_FONTS, DEFAULT_LAYOUT, migrate, themeOf } from '../../src/renderer/src/layoutCore'
import { errorLine, nowLine, sinceSummary, toolResult, toolVerb } from '../../src/renderer/src/conversationCore'
import { createStore, listEq, metaOf, shallowEq } from '../../src/renderer/src/store'

test('old layouts and themes fold into the one layout and three themes without an error', () => {
  assert.deepEqual(migrate({}), { theme: 'dark', layout: DEFAULT_LAYOUT, fonts: DEFAULT_FONTS })
  assert.deepEqual(migrate({ ui: 'focus', themeByUI: { focus: 'light' } }), { theme: 'light', layout: { ...DEFAULT_LAYOUT, focus: true }, fonts: DEFAULT_FONTS })
  assert.equal(migrate({ ui: 'workbench', themeByUI: { workbench: 'mono' } }).theme, 'dark')
  assert.equal(migrate({ ui: 'strip', themeByUI: { strip: 'hc' } }).theme, 'hc')
  assert.equal(migrate({ ui: 'strip', themeByUI: { strip: 'colour' } }).layout.focus, false)
  // junk in any field is ignored, never thrown on
  assert.deepEqual(migrate({ ui: 42, themeByUI: 'nope' }), { theme: 'dark', layout: DEFAULT_LAYOUT, fonts: DEFAULT_FONTS })
  assert.deepEqual(migrate({ appearance: { theme: 'light', layout: { rail: false, drawer: 'yes', bogus: true } } }), { theme: 'light', layout: { ...DEFAULT_LAYOUT, rail: false }, fonts: DEFAULT_FONTS })
  // a saved font choice is kept; an unknown one falls back to Inter and Cascadia Mono
  assert.deepEqual(migrate({ appearance: { theme: 'dark', fonts: { ui: 'plex', code: 'nope' } } }).fonts, { ui: 'plex', code: 'cascadia' })
  for (const t of ['default', 'mono', 'colour', undefined, null]) assert.equal(themeOf(t), 'dark')
})

const tool = (name: string, status: 'running' | 'done' | 'error', input: any = {}, output?: string) => ({ kind: 'tool', id: Math.random().toString(36), name, input, status, output })

test('since you looked: counts what happened after the mark, in plain words', () => {
  const items = [
    { kind: 'user', text: 'old' },
    tool('Edit', 'done', { file_path: 'C:/r/a.py' }),
    tool('Edit', 'done', { file_path: 'C:/r/a.py' }),
    tool('Write', 'done', { file_path: 'C:/r/b.py' }),
    tool('Agent', 'done', { description: 'Explore' }),
    tool('Bash', 'error', { command: 'x' }),
    { kind: 'assistant', text: 'done' },
  ]
  assert.equal(sinceSummary(items, 1, false), '2 files edited, 1 subagent finished, 1 failed.')
  assert.equal(sinceSummary(items, 1, true, 'Run the billing tests'), '2 files edited, 1 subagent finished, 1 failed, working now: Run the billing tests.')
  assert.equal(sinceSummary(items, items.length, false), '')
  assert.equal(sinceSummary([{ kind: 'assistant', text: 'a' }, { kind: 'assistant', text: 'b' }], 0, false), '2 replies.')
})

test('tool rows: the tool word and colour, the result, the error line', () => {
  assert.deepEqual(toolVerb('Read'), { word: 'Read', tone: 'read' })
  assert.deepEqual(toolVerb('MultiEdit'), { word: 'Edit', tone: 'edit' })
  assert.deepEqual(toolVerb('Write'), { word: 'Write', tone: 'add' })
  assert.deepEqual(toolVerb('Task'), { word: 'Agent', tone: 'agent' })
  assert.equal(toolVerb('mcp__git-host__list_prs').word, 'git')
  assert.equal(toolResult(tool('Read', 'done', {}, 'a\nb\nc') as any), '3 lines')
  assert.equal(toolResult(tool('Grep', 'done', {}, '') as any), 'no hits')
  assert.equal(toolResult(tool('Bash', 'done', {}, 'ok\nexit code 2') as any), 'exit 2')
  assert.equal(toolResult(tool('Bash', 'running', {}) as any), '')
  assert.equal(errorLine('compiling\nok\nError: boom\nmore'), 2)
  assert.equal(nowLine('Ran', 'pytest -x', { description: 'Run the billing tests' }), 'Run the billing tests')
  assert.equal(nowLine('Read', 'OutboxQueue.kt', {}), 'Read OutboxQueue.kt')
})

test('stores: a selector over the threads keeps its value while only a reply streams', () => {
  const s = createStore<any[]>([{ id: 'a', title: 'A', items: [], streaming: '', busy: true, background: false, loaded: true }])
  let calls = 0
  s.subscribe(() => calls++)
  const metas = () => s.get().map(metaOf)
  const before = metas()
  s.set((all) => all.map((x) => ({ ...x, streaming: `${x.streaming}more` })))
  assert.equal(calls, 1)
  assert.ok(listEq(shallowEq)(before, metas()), 'a streaming token leaves the shell meta equal')
  s.set((all) => all.map((x) => ({ ...x, busy: false })))
  assert.ok(!listEq(shallowEq)(before, metas()), 'a state change is seen')
  const same = s.get()
  s.set(same)
  assert.equal(calls, 2, 'setting the same value notifies no one')
})
