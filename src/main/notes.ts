// Notes: one markdown file per note in ~/.hive/hive/notes (HIVE_DATA_DIR in tests), so Claude and any editor can read
// them too. The first line is the title. Deleting moves the file to notes/_deleted, never erases it.
import { mkdirSync, watch } from 'node:fs'
import { readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataDir } from './testMode'
import { noteTitle, type NoteInfo } from '../shared/notesCore'

export const notesDir = () => join(dataDir(), 'hive', 'notes')
const valid = (id: string) => /^[\w-]+$/.test(id)
const fileOf = (id: string) => {
  if (!valid(id)) throw new Error(`Not a note id: ${id}`)
  return join(notesDir(), `${id}.md`)
}

export async function listNotes(): Promise<NoteInfo[]> {
  mkdirSync(notesDir(), { recursive: true })
  const out: NoteInfo[] = []
  for (const name of await readdir(notesDir())) {
    if (!name.endsWith('.md')) continue
    const id = name.slice(0, -3)
    if (!valid(id)) continue
    try {
      const [text, st] = await Promise.all([readFile(join(notesDir(), name), 'utf8'), stat(join(notesDir(), name))])
      out.push({ id, title: noteTitle(text), updated: st.mtimeMs, text })
    } catch { /* removed meanwhile */ }
  }
  return out.sort((a, b) => b.updated - a.updated)
}

// a new note gets an id from the time it was made (sorts, and never collides within one app)
export async function saveNote(id: string | null, text: string): Promise<string> {
  mkdirSync(notesDir(), { recursive: true })
  const nid = id ?? new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '')
  await writeFile(fileOf(nid), text, 'utf8')
  return nid
}

// Claude's add_note: the note with this title (any case) gets the text appended under it; no such note, a new one
// one at a time, so two threads adding to the same note both land
let noteChain: Promise<unknown> = Promise.resolve()
export function addToNote(title: string, text: string): Promise<{ id: string; created: boolean }> {
  const run = noteChain.then(() => appendNote(title, text))
  noteChain = run.catch(() => {})
  return run
}
async function appendNote(title: string, text: string): Promise<{ id: string; created: boolean }> {
  const t = title.trim()
  const found = (await listNotes()).find((n) => n.title.toLowerCase() === t.toLowerCase())
  if (found) return { id: await saveNote(found.id, `${found.text.replace(/\s+$/, '')}\n\n${text.trim()}\n`), created: false }
  return { id: await saveNote(null, `# ${t}\n\n${text.trim()}\n`), created: true }
}

export async function deleteNote(id: string): Promise<void> {
  const bin = join(notesDir(), '_deleted')
  mkdirSync(bin, { recursive: true })
  await rename(fileOf(id), join(bin, `${id}-${Date.now()}.md`))
}

// the folder changed (Orbit, Claude or another editor): tell the window to reload the list
export function watchNotes(onChange: () => void, delay = 200): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    mkdirSync(notesDir(), { recursive: true })
    const w = watch(notesDir(), () => { clearTimeout(timer); timer = setTimeout(onChange, delay) })
    w.on('error', () => {})
    return () => { clearTimeout(timer); w.close() }
  } catch {
    return () => {}
  }
}
