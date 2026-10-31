import { createContext, useContext, useEffect, useState } from 'react'
import { lookup, type Decorations } from '../../shared/fileDecoCore'

// which file is open in Preview, how to open one, and the git decorations; shared by every row in the tree
const EMPTY: Decorations = { files: {}, dirs: {}, inherit: {} }
const Open = createContext<{ selected: string | null; open: (path: string) => void; deco: Decorations }>({ selected: null, open: () => {}, deco: EMPTY })

const name = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) ?? p

// file-type marks in the Seti colours VS Code ships: [glyph, colour class]
const ICONS: Record<string, [string, string]> = {
  ts: ['TS', 'ic-blue'], tsx: ['TS', 'ic-cyan'], mts: ['TS', 'ic-blue'], cts: ['TS', 'ic-blue'],
  js: ['JS', 'ic-yellow'], jsx: ['JS', 'ic-cyan'], mjs: ['JS', 'ic-yellow'], cjs: ['JS', 'ic-yellow'],
  json: ['{}', 'ic-yellow'], jsonc: ['{}', 'ic-yellow'],
  py: ['py', 'ic-py'], ipynb: ['nb', 'ic-orange'],
  md: ['M↓', 'ic-blue'], mdx: ['M↓', 'ic-blue'], txt: ['≡', 'ic-grey'],
  html: ['<>', 'ic-orange'], htm: ['<>', 'ic-orange'], vue: ['V', 'ic-green'],
  css: ['#', 'ic-blue'], scss: ['#', 'ic-pink'], less: ['#', 'ic-blue'],
  yml: ['!', 'ic-purple'], yaml: ['!', 'ic-purple'], toml: ['⚙', 'ic-grey'], ini: ['⚙', 'ic-grey'], env: ['⚙', 'ic-yellow'],
  sh: ['$', 'ic-green'], ps1: ['>_', 'ic-blue'], bat: ['>_', 'ic-green'], cmd: ['>_', 'ic-green'],
  sql: ['db', 'ic-pink'], csv: ['▦', 'ic-green'], xlsx: ['▦', 'ic-green'], xls: ['▦', 'ic-green'],
  png: ['◩', 'ic-purple'], jpg: ['◩', 'ic-purple'], jpeg: ['◩', 'ic-purple'], gif: ['◩', 'ic-purple'], svg: ['◩', 'ic-orange'], webp: ['◩', 'ic-purple'], ico: ['◩', 'ic-yellow'],
  pdf: ['▤', 'ic-red'], docx: ['W', 'ic-blue'], pptx: ['P', 'ic-orange'],
  go: ['go', 'ic-cyan'], rs: ['rs', 'ic-orange'], java: ['J', 'ic-red'], kt: ['K', 'ic-orange'], cs: ['C#', 'ic-blue'],
  lock: ['≡', 'ic-grey'], log: ['≡', 'ic-grey'],
}
const NAMED: Record<string, [string, string]> = {
  'package.json': ['{}', 'ic-green'], dockerfile: ['◈', 'ic-blue'], makefile: ['M', 'ic-orange'], license: ['§', 'ic-yellow'],
  '.gitignore': ['◆', 'ic-orange'], '.gitattributes': ['◆', 'ic-orange'], '.env': ['⚙', 'ic-yellow'], 'readme.md': ['i', 'ic-blue'],
}
function icon(file: string): [string, string] {
  const n = file.toLowerCase()
  const ext = n.includes('.') ? n.slice(n.lastIndexOf('.') + 1) : ''
  return NAMED[n] ?? (n.startsWith('.env') ? NAMED['.env'] : ICONS[ext]) ?? ['·', 'ic-grey']
}

function Folder({ path, depth }: { path: string; depth: number }) {
  const [items, setItems] = useState<FsEntry[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    window.api.listDir(path).then(setItems).catch((e) => setError(String(e?.message ?? e)))
  }, [path])

  if (error) return <div className="frow muted" style={{ paddingLeft: 12 + depth * 12 }}>Can't open folder</div>
  return <>{items?.map((e) => (e.dir ? <DirRow key={e.path} entry={e} depth={depth} /> : <FileRow key={e.path} entry={e} depth={depth} />))}</>
}

function DirRow({ entry, depth }: { entry: FsEntry; depth: number }) {
  const [open, setOpen] = useState(false)
  const d = lookup(useContext(Open).deco, entry.path, true)
  return (
    <>
      <button data-testid="file-dir" data-name={entry.name} className={`frow${d ? ` g-${d.kind}` : ''}`} style={{ paddingLeft: 8 + depth * 12 }} onClick={() => setOpen((o) => !o)}>
        <span className={open ? 'chev open' : 'chev'}>›</span>
        <span className="fname">{entry.name}</span>
        {d && d.kind !== 'ignored' && <span className="gdot" />}
      </button>
      {open && <Folder path={entry.path} depth={depth + 1} />}
    </>
  )
}

function FileRow({ entry, depth }: { entry: FsEntry; depth: number }) {
  const { selected, open, deco } = useContext(Open)
  const d = lookup(deco, entry.path, false)
  const [glyph, color] = icon(entry.name)
  return (
    <button data-testid="file-row" data-name={entry.name} className={`frow file${selected === entry.path ? ' sel' : ''}${d ? ` g-${d.kind}` : ''}`} style={{ paddingLeft: 8 + depth * 12 }} title={entry.path} onClick={() => open(entry.path)}>
      <span className={`ficon ${color}`}>{glyph}</span>
      <span className="fname">{entry.name}</span>
      {d?.letter && <span className="gletter">{d.letter}</span>}
    </button>
  )
}

// git status for the browsed folder: on open, when the window regains focus, and after an agent edits or writes a file
function useDecorations(root: string): Decorations {
  const [deco, setDeco] = useState<Decorations>(EMPTY)
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = (fresh: boolean) => window.api.gitDecorations(root, fresh).then((d) => { if (alive) setDeco(d) }, () => {})
    load(false)
    const onFocus = () => load(false)
    window.addEventListener('focus', onFocus)
    const offChat = window.api.onChatEvent((_tab, ev) => {
      const r = ev?.type === 'user' ? ev.tool_use_result : undefined
      if (!r || !(r.filePath || r.structuredPatch)) return
      clearTimeout(timer)
      timer = setTimeout(() => load(true), 400) // a burst of edits costs one status
    })
    return () => { alive = false; clearTimeout(timer); window.removeEventListener('focus', onFocus); offChat() }
  }, [root])
  return deco
}

type Props = { root: string; onOpenFolder: () => void; selected: string | null; onOpenFile: (path: string) => void }

export function FileTree({ root, onOpenFolder, selected, onOpenFile }: Props) {
  const deco = useDecorations(root)
  return (
    <aside data-testid="file-tree" className="side files">
      <div className="sidehead" title={root}>
        <span><span className="ph ph-files">▤</span>{name(root)}</span>
        <button data-testid="files-button-1" className="link" onClick={onOpenFolder}>Open folder…</button>
      </div>
      <div className="slist">
        <Open.Provider value={{ selected, open: onOpenFile, deco }}>
          <Folder key={root} path={root} depth={0} />
        </Open.Provider>
      </div>
    </aside>
  )
}
