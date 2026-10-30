import { createContext, useContext, useEffect, useState } from 'react'

// which file is open in Preview, and how to open one; shared by every row in the tree
const Open = createContext<{ selected: string | null; open: (path: string) => void }>({ selected: null, open: () => {} })

const name = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) ?? p

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
  return (
    <>
      <button className="frow" style={{ paddingLeft: 8 + depth * 12 }} onClick={() => setOpen((o) => !o)}>
        <span className={open ? 'chev open' : 'chev'}>›</span>
        <span className="fname">{entry.name}</span>
      </button>
      {open && <Folder path={entry.path} depth={depth + 1} />}
    </>
  )
}

function FileRow({ entry, depth }: { entry: FsEntry; depth: number }) {
  const { selected, open } = useContext(Open)
  return (
    <button className={selected === entry.path ? 'frow file sel' : 'frow file'} style={{ paddingLeft: 8 + depth * 12 + 14 }} title={entry.path} onClick={() => open(entry.path)}>
      <span className="fname">{entry.name}</span>
    </button>
  )
}

type Props = { root: string; onOpenFolder: () => void; selected: string | null; onOpenFile: (path: string) => void }

export function FileTree({ root, onOpenFolder, selected, onOpenFile }: Props) {
  return (
    <aside className="side">
      <div className="sidehead" title={root}>
        <span>{name(root)}</span>
        <button className="link" onClick={onOpenFolder}>Open folder…</button>
      </div>
      <div className="slist">
        <Open.Provider value={{ selected, open: onOpenFile }}>
          <Folder key={root} path={root} depth={0} />
        </Open.Provider>
      </div>
    </aside>
  )
}
