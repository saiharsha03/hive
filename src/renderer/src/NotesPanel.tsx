// Notes: markdown files in ~/.hive/hive/notes as a panel. A searchable list on the left, the note on the right; typing
// saves on its own after a short pause, and the first line is the title. Preview renders the markdown. Delete moves the
// file to notes/_deleted.
import { useEffect, useMemo, useRef, useState } from 'react'
import { filterNotes, type NoteInfo } from '../../shared/notesCore'
import { MdBody } from './MdBody'

const SAVE_MS = 600
const NEW = '\u0000new'
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000)
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function NotesPanel() {
  const [notes, setNotes] = useState<NoteInfo[]>([])
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState('')
  // NEW = the note being written that has no file yet; its id arrives with the first save (newId)
  const pending = useRef<{ id: string; text: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const selRef = useRef<string | null>(null)
  selRef.current = sel
  const newId = useRef<string | null>(null)
  const chain = useRef(Promise.resolve())
  // saves under way, a count that goes up with every save, and the text this panel last read or wrote for the open
  // note: together they tell a change made elsewhere (Claude, another program) from the echo of our own save
  const saving = useRef(0)
  const saveGen = useRef(0)
  const mine = useRef('')

  const load = () => {
    const gen = saveGen.current
    return window.api.listNotes().then((list) => {
      setNotes(list)
      // the open note changed on disk and nothing typed here is waiting: show the new text, so the next keystroke
      // does not save the old one over it
      const id = selRef.current
      const n = id ? list.find((x) => x.id === id) : undefined
      if (n && !pending.current && !saving.current && gen === saveGen.current && n.text !== mine.current) { mine.current = n.text; setText(n.text) }
    }, (e) => setError(String(e?.message ?? e)))
  }
  useEffect(() => { void load(); return window.api.onNotesChanged(() => { void load() }) }, [])

  // write what was typed, one save at a time, so a new note is created once and later saves update it
  const flush = () => (chain.current = chain.current.then(async () => {
    clearTimeout(timer.current)
    const p = pending.current
    if (!p) return
    pending.current = null
    const isNew = p.id === NEW
    saving.current++
    let id: string
    try { id = await window.api.saveNote(isNew ? newId.current : p.id, p.text) } finally { saving.current--; saveGen.current++ }
    if ((isNew ? selRef.current === null : selRef.current === p.id)) mine.current = p.text
    if (isNew && !newId.current) { newId.current = id; if (selRef.current === null) setSel(id) }
  }).catch((e) => setError(String((e as Error)?.message ?? e))))
  useEffect(() => () => { void flush() }, [])

  const open = (n: NoteInfo) => { void flush(); mine.current = n.text; setSel(n.id); setText(n.text); setPreview(false) }
  const create = () => { void flush().then(() => { newId.current = null }); mine.current = ''; setSel(null); setText(''); setPreview(false); setQuery('') }
  const edit = (v: string) => {
    setText(v)
    pending.current = { id: selRef.current ?? NEW, text: v }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), SAVE_MS)
  }
  const remove = async () => {
    // what was typed and not saved yet goes too: without this the pending save would bring the note back
    pending.current = null
    clearTimeout(timer.current)
    // a new note may be on its way to disk (its first save is running): wait for its id, then delete that file
    await chain.current
    const id = sel ?? newId.current
    newId.current = null
    mine.current = ''
    setSel(null); setText('')
    if (id) await window.api.deleteNote(id).catch((e) => setError(String(e?.message ?? e)))
  }

  const shown = useMemo(() => filterNotes(notes, query), [notes, query])
  const editing = sel !== null || text !== ''

  return (
    <section data-testid="notes-panel" className="tool notes">
      <div className="dhead">
        <span className="dtitle">Notes</span>
        <span className="dnote">{notes.length} note{notes.length === 1 ? '' : 's'}, saved as markdown in ~/.hive/hive/notes</span>
        <span className="dspace" />
        <button className="dlink" onClick={create} data-testid="notes-new">New note</button>
      </div>
      {error && <div className="derr" data-testid="notes-error">{error}</div>}
      <div className="nt-body">
        <div className="nt-list">
          <input className="search" placeholder="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="notes-search" />
          {shown.map((n) => (
            <button key={n.id} className={`nt-row${n.id === sel ? ' cur' : ''}`} onClick={() => open(n)} data-testid="note-row">
              <span className="nt-title">{n.title}</span>
              <span className="nt-when">{ago(n.updated)}</span>
            </button>
          ))}
          {!shown.length && <div className="dnote nt-empty">{notes.length ? 'No note matches.' : 'No notes yet.'}</div>}
        </div>
        <div className="nt-edit">
          <div className="nt-bar">
            <button className={preview ? 'dlink' : 'dlink on'} onClick={() => setPreview(false)} data-testid="notes-write">Write</button>
            <button className={preview ? 'dlink on' : 'dlink'} onClick={() => setPreview(true)} data-testid="notes-preview">Preview</button>
            <span className="dspace" />
            {editing && <button className="dlink" onClick={() => void remove()} data-testid="notes-delete">Delete</button>}
          </div>
          {preview
            ? <div className="nt-preview md" data-testid="notes-rendered"><MdBody text={text || '*Empty note*'} copy={false} /></div>
            : <textarea className="nt-text" value={text} placeholder={'Title on the first line\n\nThen anything: markdown works.'} onChange={(e) => edit(e.target.value)} onBlur={() => void flush()} data-testid="notes-text" />}
        </div>
      </div>
    </section>
  )
}
