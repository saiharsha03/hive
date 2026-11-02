// The code editor: Monaco with tabs, Ctrl+S, and the language servers (Python/Django, TS/JS, Vue) through lspBridge.
// Files open from Files, Preview, Changes or a go-to-definition. A file changed on disk reloads by itself when it has
// no unsaved edits, and asks when it has. Debugging and the rest go to VS Code (Open in VS Code).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { monaco } from './monacoSetup'
import { attach, registerLanguageFeatures, saved, setEnsureModel } from './lspBridge'
import { langOf, monacoLanguageOf } from '../../shared/editorCore'
import { kindOf, Preview } from './Preview'
import { MdBody } from './MdBody'

type Doc = { model: monaco.editor.ITextModel; savedVersion: number; mtime: number; sync: monaco.IDisposable; viewState: monaco.editor.ICodeEditorViewState | null }

// ---- the open files (a small store, so Files, Preview and Changes can open a file from anywhere) ----
let tabs: string[] = []
let active: string | null = null
let reveal: { path: string; line: number; column: number } | null = null
let onOpen: () => void = () => {}
const listeners = new Set<() => void>()
const emit = () => { snapshot = { tabs, active }; listeners.forEach((l) => l()) }
let snapshot: { tabs: string[]; active: string | null } = { tabs, active }
export const setEditorShown = (f: () => void) => { onOpen = f }
export function openInEditor(path: string, line?: number, column = 1): void {
  if (!tabs.includes(path)) tabs = [...tabs, path]
  active = path
  if (line) reveal = { path, line, column }
  emit()
  onOpen()
}
const closeTab = (path: string) => {
  const i = tabs.indexOf(path)
  tabs = tabs.filter((t) => t !== path)
  if (active === path) active = tabs[Math.min(i, tabs.length - 1)] ?? null
  emit()
}
const useOpenFiles = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => snapshot)

const docs = new Map<string, Doc>()
const base = (p: string) => p.split(/[\\/]/).pop() ?? p
const SERVER: Record<string, string> = { python: 'Pyright', typescript: 'TypeScript', vue: 'Vue' }
// images, PDFs and media are shown, not edited; Markdown and HTML can be shown rendered too
const shownOnly = (p: string) => !['text', 'html'].includes(kindOf(p))
const renderable = (p: string) => kindOf(p) === 'html' || /\.(md|markdown)$/i.test(p)

async function load(path: string): Promise<Doc> {
  const have = docs.get(path)
  if (have) return have
  const { text, mtime } = await window.api.editorRead(path)
  const uri = monaco.Uri.file(path)
  const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(text, monacoLanguageOf(path), uri)
  const doc: Doc = { model, savedVersion: model.getAlternativeVersionId(), mtime, sync: attach(model), viewState: null }
  docs.set(path, doc)
  return doc
}
// a rename that touches files not open yet: they open as tabs (unsaved) so the edit can apply
setEnsureModel(async (path) => { await load(path); if (!tabs.includes(path)) { tabs = [...tabs, path]; emit() } })

const dirty = (path: string) => { const d = docs.get(path); return !!d && d.model.getAlternativeVersionId() !== d.savedVersion }

export function EditorView() {
  const { tabs: open, active: cur } = useOpenFiles()
  const host = useRef<HTMLDivElement>(null)
  const ed = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const [, bump] = useState(0)
  const [full, setFull] = useState(false)
  const [closing, setClosing] = useState<string | null>(null)
  const [changed, setChanged] = useState<string | null>(null) // edited here and changed on disk
  const [error, setError] = useState('')
  const curRef = useRef(cur)
  curRef.current = cur

  const save = async (path = curRef.current) => {
    const d = path && docs.get(path)
    if (!path || !d) return
    try {
      d.mtime = await window.api.editorWrite(path, d.model.getValue())
      d.savedVersion = d.model.getAlternativeVersionId()
      saved(d.model)
      if (changed === path) setChanged(null)
      bump((n) => n + 1)
    } catch (e) { setError(String((e as Error)?.message ?? e)) }
  }
  const saveRef = useRef(save)
  saveRef.current = save

  // the editor, once
  useEffect(() => {
    if (!host.current) return
    const light = () => document.documentElement.dataset.theme === 'light'
    const e = monaco.editor.create(host.current, {
      automaticLayout: true, theme: light() ? 'vs' : 'vs-dark', fontSize: 13, minimap: { enabled: true }, scrollBeyondLastLine: false,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || undefined, model: null, fixedOverflowWidgets: true,
    })
    ed.current = e
    e.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveRef.current())
    const sub = e.onDidChangeModelContent(() => bump((n) => n + 1))
    registerLanguageFeatures((file, line, column) => openInEditor(file, line, column))
    const theme = new MutationObserver(() => monaco.editor.setTheme(light() ? 'vs' : 'vs-dark'))
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => { sub.dispose(); theme.disconnect(); e.dispose(); ed.current = null }
  }, [])

  // show the active file (and go where a definition or a click asked)
  useEffect(() => {
    const e = ed.current
    if (!e) return
    if (!cur || shownOnly(cur)) { e.setModel(null); return }
    let stale = false
    load(cur).then((d) => {
      if (stale) return
      const prev = e.getModel()
      if (prev && prev !== d.model) { const p = [...docs.values()].find((x) => x.model === prev); if (p) p.viewState = e.saveViewState() }
      if (prev !== d.model) { e.setModel(d.model); if (d.viewState) e.restoreViewState(d.viewState) }
      if (reveal?.path === cur) { const r = reveal; reveal = null; e.setPosition({ lineNumber: r.line, column: r.column }); e.revealLineInCenter(r.line) }
      e.focus()
      setError('')
    }, (err) => { if (!stale) { setError(String(err?.message ?? err)); closeTab(cur) } })
    return () => { stale = true }
  }, [cur])

  // something else changed the file (Claude, git): reload it when it has no unsaved edits, else ask
  useEffect(() => {
    const check = async () => {
      const path = curRef.current
      const d = path && docs.get(path)
      if (!path || !d || shownOnly(path)) return
      const m = await window.api.editorMtime(path)
      if (m === null || m === d.mtime) return
      if (dirty(path)) { setChanged(path); return }
      const { text, mtime } = await window.api.editorRead(path)
      d.model.pushEditOperations([], [{ range: d.model.getFullModelRange(), text }], () => null)
      d.savedVersion = d.model.getAlternativeVersionId()
      d.mtime = mtime
      bump((n) => n + 1)
    }
    const t = setInterval(() => void check(), 2000)
    window.addEventListener('focus', check)
    return () => { clearInterval(t); window.removeEventListener('focus', check) }
  }, [])

  const discard = (path: string) => {
    const d = docs.get(path)
    if (d) { d.sync.dispose(); d.model.dispose(); docs.delete(path) }
    setClosing(null)
    closeTab(path)
  }
  const askClose = (path: string) => (dirty(path) ? setClosing(path) : discard(path))
  const reloadFromDisk = async (path: string) => {
    const d = docs.get(path)
    if (!d) return
    const { text, mtime } = await window.api.editorRead(path)
    d.model.pushEditOperations([], [{ range: d.model.getFullModelRange(), text }], () => null)
    d.savedVersion = d.model.getAlternativeVersionId()
    d.mtime = mtime
    setChanged(null)
  }

  const lang = cur ? langOf(cur) : null
  const [rendered, setRendered] = useState(false)
  useEffect(() => setRendered(false), [cur])
  const showing = !!cur && (shownOnly(cur) || (rendered && renderable(cur)))
  return (
    <section className={full ? 'tool editor ed-full' : 'tool editor'} data-testid="editor-view">
      <div className="ed-tabs">
        {open.map((p) => (
          <div key={p} className={`ed-tab${p === cur ? ' cur' : ''}`} title={p} data-testid="editor-tab">
            <button className="ed-name" onClick={() => openInEditor(p)}>{base(p)}</button>
            <button className="ed-x" aria-label={`Close ${base(p)}`} onClick={() => askClose(p)} data-testid="editor-tab-close">{dirty(p) ? '●' : '×'}</button>
          </div>
        ))}
        <span className="dspace" />
        {cur && renderable(cur) && <button className="dlink" onClick={() => setRendered((r) => !r)} data-testid="editor-render">{rendered ? 'Edit' : 'Preview'}</button>}
        {cur && !shownOnly(cur) && <span className="dnote ed-lang">{lang ? `${SERVER[lang]} language server` : monacoLanguageOf(cur)}</span>}
        {cur && <button className="dlink" onClick={() => void window.api.openInVsCode(cur, ed.current?.getPosition()?.lineNumber ?? 1)} data-testid="editor-vscode">Open in VS Code</button>}
        <button className="dlink" onClick={() => setFull((f) => !f)} data-testid="editor-full">{full ? 'Exit full window' : 'Full window'}</button>
      </div>
      {closing && (
        <div className="ed-bar" data-testid="editor-unsaved">
          {base(closing)} has unsaved changes.
          <button className="dlink" onClick={() => void save(closing).then(() => discard(closing))}>Save</button>
          <button className="dlink" onClick={() => discard(closing)} data-testid="editor-discard">Discard</button>
          <button className="dlink" onClick={() => setClosing(null)}>Cancel</button>
        </div>
      )}
      {changed && changed === cur && (
        <div className="ed-bar" data-testid="editor-changed">
          {base(changed)} changed on disk while you edited it.
          <button className="dlink" onClick={() => void reloadFromDisk(changed)}>Reload theirs</button>
          <button className="dlink" onClick={() => void save(changed)}>Keep mine (save)</button>
        </div>
      )}
      {error && <div className="derr ed-err" data-testid="editor-error">{error}</div>}
      {!open.length && <div className="pane-empty">Open a file from Files or Git: code and text to edit, images, PDFs and pages to look at.</div>}
      {showing && cur && <div className="ed-shown">{/\.(md|markdown)$/i.test(cur) ? <div className="nt-preview md"><MdBody text={docs.get(cur)?.model.getValue() ?? ''} copy={false} /></div> : <Preview key={cur} path={cur} onClose={() => askClose(cur)} />}</div>}
      <div ref={host} className="ed-host" style={open.length && !showing ? undefined : { display: 'none' }} data-testid="editor-host" />
    </section>
  )
}
