// Files open as tabs next to the threads (tab id "file:<path>"), like VS Code. Each tab is a FileEditor: Monaco with
// the language servers (Python/Django, TS/JS, Vue) for code and text, a rendered view for images, PDFs and media, and
// a Preview toggle for Markdown and HTML. Models live here, so a tab keeps its edits, cursor and scroll while it is
// hidden. A file changed on disk reloads by itself when it has no unsaved edits, and asks when it has.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { monaco } from './monacoSetup'
import { attach, registerLanguageFeatures, saved, setEnsureModel } from './lspBridge'
import { langOf, monacoLanguageOf } from '../../shared/editorCore'
import { kindOf, Preview } from './Preview'
import { MdBody } from './MdBody'

type Doc = { model: monaco.editor.ITextModel; savedVersion: number; mtime: number; sync: monaco.IDisposable; viewState: monaco.editor.ICodeEditorViewState | null; dirty: boolean }

const FILE_TAB = 'file:'
export const fileTabId = (path: string) => `${FILE_TAB}${path}`
export const fileOfTab = (id: string) => (id.startsWith(FILE_TAB) ? id.slice(FILE_TAB.length) : null)
const base = (p: string) => p.split(/[\\/]/).pop() ?? p
const SERVER: Record<string, string> = { python: 'Pyright', typescript: 'TypeScript', vue: 'Vue' }

// Monaco keeps the familiar VS Code look: its own vs-dark / vs / hc-black themes and syntax colours, picked to match
// the window's theme
const vsTheme = () => {
  const t = document.documentElement.dataset.theme
  return t === 'light' ? 'vs' : t === 'hc' ? 'hc-black' : 'vs-dark'
}

// the problems in one file, from its model's markers (the language server's diagnostics)
function useProblems(path: string, ready: boolean): monaco.editor.IMarker[] {
  const [list, setList] = useState<monaco.editor.IMarker[]>([])
  useEffect(() => {
    const read = () => {
      const m = docs.get(path)?.model
      setList(m ? monaco.editor.getModelMarkers({ resource: m.uri }).filter((x) => x.severity >= monaco.MarkerSeverity.Warning).sort((a, b) => b.severity - a.severity || a.startLineNumber - b.startLineNumber) : [])
    }
    read()
    const off = monaco.editor.onDidChangeMarkers(read)
    return () => off.dispose()
  }, [path, ready])
  return list
}
// the file's place in its repo: ledger-api > billing > invoice.py
function useCrumbs(path: string): string[] {
  const [crumbs, setCrumbs] = useState<string[]>(() => path.split(/[\\/]/).slice(-3))
  useEffect(() => {
    let alive = true
    window.api.gitLocate(path).then((at) => { if (alive && at) setCrumbs([at.name, ...at.path.split('/')]) }).catch(() => {})
    return () => { alive = false }
  }, [path])
  return crumbs
}
// images, PDFs and media are shown, not edited; Markdown and HTML can be shown rendered too
const shownOnly = (p: string) => !['text', 'html'].includes(kindOf(p))
const renderable = (p: string) => kindOf(p) === 'html' || /\.(md|markdown)$/i.test(p)

// ---- opening a file (the app turns it into a tab) and where to put the cursor ----
let opener: (path: string) => void = () => {}
export const setFileOpener = (f: (path: string) => void) => { opener = f }
const reveals = new Map<string, { line: number; column: number }>()
// the editor showing a file, told when a place in it is asked for (no polling)
const revealers = new Map<string, () => void>()
export function openInEditor(path: string, line?: number, column = 1): void {
  if (line) reveals.set(path, { line, column })
  opener(path)
  revealers.get(path)?.()
}

// ---- models, and which files have unsaved edits (the tab bar shows a dot) ----
const docs = new Map<string, Doc>()
let dirtyVersion = 0
const dirtyListeners = new Set<() => void>()
const dirtyChanged = () => { dirtyVersion++; dirtyListeners.forEach((l) => l()) }
export const isDirty = (path: string) => { const d = docs.get(path); return !!d && d.model.getAlternativeVersionId() !== d.savedVersion }
export const useDirtyVersion = () => useSyncExternalStore((l) => { dirtyListeners.add(l); return () => { dirtyListeners.delete(l) } }, () => dirtyVersion)

async function load(path: string): Promise<Doc> {
  const have = docs.get(path)
  if (have) return have
  const { text, mtime } = await window.api.editorRead(path)
  const uri = monaco.Uri.file(path)
  const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(text, monacoLanguageOf(path), uri)
  const doc: Doc = { model, savedVersion: model.getAlternativeVersionId(), mtime, sync: attach(model), viewState: null, dirty: false }
  // tabs re-render when the unsaved state flips, not on every keystroke
  model.onDidChangeContent(() => { const now = model.getAlternativeVersionId() !== doc.savedVersion; if (now !== doc.dirty) { doc.dirty = now; dirtyChanged() } })
  docs.set(path, doc)
  dirtyChanged() // tabs showing it re-render (a Markdown tab that opened rendered gets its text)
  return doc
}
// a rename that touches files not open yet: they open as tabs (unsaved) so the edit can apply
setEnsureModel(async (path) => { await load(path); opener(path) })

// closing a tab: a file with unsaved edits stays open and asks first (closeRequests); otherwise its model goes
const closeRequests = new Set<string>()
export function releaseFile(path: string): boolean {
  if (isDirty(path)) { closeRequests.add(path); dirtyChanged(); return false }
  discard(path)
  return true
}
function discard(path: string) {
  const d = docs.get(path)
  if (d) { d.sync.dispose(); d.model.dispose(); docs.delete(path) }
  closeRequests.delete(path)
  dirtyChanged()
}

const problemCount = (ps: monaco.editor.IMarker[]) => {
  const e = ps.filter((p) => p.severity === monaco.MarkerSeverity.Error).length
  const w = ps.length - e
  return [e ? `${e} error${e === 1 ? '' : 's'}` : '', w ? `${w} warning${w === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')
}
// "Ask Claude to fix": the file's problems go into the message box of the thread last on screen
let askFix: (path: string, text: string) => void = () => {}
export const setAskFix = (f: (path: string, text: string) => void) => { askFix = f }
const askToFix = (path: string, ps: monaco.editor.IMarker[]) =>
  askFix(path, `Fix the problems in ${path}:\n${ps.slice(0, 10).map((p) => `- line ${p.startLineNumber}: ${p.message.split('\n')[0]}`).join('\n')}`)

export function FileEditor({ path, onClosed }: { path: string; onClosed: () => void }) {
  useDirtyVersion()
  const host = useRef<HTMLDivElement>(null)
  const ed = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  // HTML and Markdown open rendered; Code shows (and edits) the source
  const [rendered, setRendered] = useState(() => renderable(path))
  const [changed, setChanged] = useState(false) // edited here and changed on disk
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const media = shownOnly(path)
  const crumbs = useCrumbs(path)
  const problems = useProblems(path, ready)
  const showing = media || (rendered && renderable(path))

  // true when the file was written. A file changed on disk since it was read is not overwritten: the bar asks
  // (force = "Keep mine"). A failed save leaves the edits in the editor.
  const save = async (force = false): Promise<boolean> => {
    const d = docs.get(path)
    if (!d) return false
    try {
      d.mtime = await window.api.editorWrite(path, d.model.getValue(), force ? null : d.mtime)
      d.savedVersion = d.model.getAlternativeVersionId()
      d.dirty = false
      saved(d.model)
      setChanged(false)
      setError('')
      dirtyChanged()
      return true
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      if (/changed on disk/.test(msg)) setChanged(true)
      else setError(msg)
      return false
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save

  // this tab's editor, showing the file's shared model
  useEffect(() => {
    if (media || !host.current) return
    const light = () => document.documentElement.dataset.theme === 'light'
    const e = monaco.editor.create(host.current, {
      automaticLayout: true, theme: vsTheme(), fontSize: 13, minimap: { enabled: true }, scrollBeyondLastLine: false,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || undefined, model: null, fixedOverflowWidgets: true,
    })
    ed.current = e
    e.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveRef.current())
    registerLanguageFeatures((file, line, column) => openInEditor(file, line, column))
    void light
    const theme = new MutationObserver(() => monaco.editor.setTheme(vsTheme()))
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    let alive = true
    load(path).then((d) => {
      if (!alive) return
      e.setModel(d.model)
      setReady(true)
      if (d.viewState) e.restoreViewState(d.viewState)
      e.focus()
      revealRef.current()
    }, (err) => setError(String(err?.message ?? err)))
    return () => {
      alive = false
      const d = docs.get(path)
      if (d && e.getModel() === d.model) d.viewState = e.saveViewState()
      theme.disconnect(); e.dispose(); ed.current = null
    }
  }, [path, media])

  // go where a definition or a search result asked: when asked, and once the file has loaded
  const reveal = () => {
    const r = reveals.get(path)
    const e = ed.current
    if (!r || !e?.getModel()) return
    reveals.delete(path)
    e.setPosition({ lineNumber: r.line, column: r.column })
    e.revealLineInCenter(r.line)
    e.focus()
  }
  const revealRef = useRef(reveal)
  revealRef.current = reveal
  useEffect(() => {
    const f = () => revealRef.current()
    revealers.set(path, f)
    return () => { if (revealers.get(path) === f) revealers.delete(path) }
  }, [path])

  // something else changed the file (Claude, git): reload it when it has no unsaved edits, else ask
  useEffect(() => {
    if (media) return
    const check = async () => {
      const d = docs.get(path)
      if (!d) return
      const m = await window.api.editorMtime(path)
      if (m === null || m === d.mtime) return
      if (isDirty(path)) { setChanged(true); return }
      const { text, mtime } = await window.api.editorRead(path)
      d.model.pushEditOperations([], [{ range: d.model.getFullModelRange(), text }], () => null)
      d.savedVersion = d.model.getAlternativeVersionId()
      d.dirty = false
      d.mtime = mtime
      dirtyChanged()
    }
    // a tab that was hidden did not watch the file: look at once when it shows again
    void check()
    const t = setInterval(() => void check(), 2000)
    window.addEventListener('focus', check)
    return () => { clearInterval(t); window.removeEventListener('focus', check) }
  }, [path, media])

  const reloadFromDisk = async () => {
    const d = docs.get(path)
    if (!d) return
    const { text, mtime } = await window.api.editorRead(path)
    d.model.pushEditOperations([], [{ range: d.model.getFullModelRange(), text }], () => null)
    d.savedVersion = d.model.getAlternativeVersionId()
    d.dirty = false
    d.mtime = mtime
    setChanged(false)
    dirtyChanged()
  }

  const lang = langOf(path)
  const closing = closeRequests.has(path)
  return (
    <section className="tool editor" data-testid="editor-view" data-path={path}>
      <div className="ed-tabs ed-crumb">
        <span className="ed-path" title={path}>{crumbs.map((c, i) => <span key={i}>{i > 0 && <b> &gt; </b>}{c}</span>)}</span>
        <span className="dspace" />
        {renderable(path) && (
          <span className="seg ed-seg" role="group" aria-label="View">
            <button className={rendered ? 'on' : ''} aria-pressed={rendered} onClick={() => setRendered(true)} data-testid="editor-rendered">Rendered</button>
            <button className={rendered ? '' : 'on'} aria-pressed={!rendered} onClick={() => setRendered(false)} data-testid="editor-code">Code</button>
          </span>
        )}
        {!media && !(rendered && renderable(path)) && <span className={lang ? 'ed-lang lsp' : 'ed-lang'}>{lang ? `${SERVER[lang]}${ready ? ' ready' : ''}` : monacoLanguageOf(path)}</span>}
        {!media && <button className="dlink" onClick={() => void window.api.openInVsCode(path, ed.current?.getPosition()?.lineNumber ?? 1)} data-testid="editor-vscode">Open in VS Code</button>}
      </div>
      {closing && (
        <div className="ed-bar" data-testid="editor-unsaved">
          {base(path)} has unsaved changes.
          <button className="dlink" onClick={() => void save().then((ok) => { if (ok) { discard(path); onClosed() } })}>Save</button>
          <button className="dlink" onClick={() => { discard(path); onClosed() }} data-testid="editor-discard">Discard</button>
          <button className="dlink" onClick={() => { closeRequests.delete(path); dirtyChanged() }}>Cancel</button>
        </div>
      )}
      {changed && (
        <div className="ed-bar" data-testid="editor-changed">
          {base(path)} changed on disk while you edited it.
          <button className="dlink" onClick={() => void reloadFromDisk()}>Reload theirs</button>
          <button className="dlink" onClick={() => void save(true)}>Keep mine (save)</button>
        </div>
      )}
      {error && <div className="derr ed-err" data-testid="editor-error">{error}</div>}
      {showing && <div className="ed-shown">{/\.(md|markdown)$/i.test(path) ? <div className="nt-preview md"><MdBody text={docs.get(path)?.model.getValue() ?? ''} copy={false} /></div> : <Preview key={path} path={path} onClose={onClosed} />}</div>}
      {!media && <div ref={host} className="ed-host" style={showing ? { display: 'none' } : undefined} data-testid="editor-host" />}
      {!media && !showing && (
        <div className="ed-problems" data-testid="editor-problems">
          <span className="pk">Problems</span>
          {problems.length ? <>
            <span className={problems[0].severity === monaco.MarkerSeverity.Error ? 'pe' : 'pw'}>{problemCount(problems)}</span>
            <button className="pl" onClick={() => { ed.current?.setPosition({ lineNumber: problems[0].startLineNumber, column: problems[0].startColumn }); ed.current?.revealLineInCenter(problems[0].startLineNumber); ed.current?.focus() }} title={problems[0].message}>Line {problems[0].startLineNumber}: {problems[0].message.split('\n')[0]}</button>
            <button className="pr" onClick={() => askToFix(path, problems)} data-testid="editor-ask-fix">Ask Claude to fix</button>
          </> : <span className="pn">None</span>}
        </div>
      )}
    </section>
  )
}
