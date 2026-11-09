// Notes, the pure part: what the list shows for a note and how it is filtered.
export type NoteInfo = { id: string; title: string; updated: number; text: string }

// the first non-empty line without markdown heading marks; an empty note is "Untitled"
export function noteTitle(text: string): string {
  const line = text.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean)
  return line ? line.slice(0, 120) : 'Untitled'
}

// every word of the query must appear somewhere in the note (case-insensitive)
export function filterNotes(notes: NoteInfo[], query: string): NoteInfo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return notes
  return notes.filter((n) => { const t = n.text.toLowerCase(); return words.every((w) => t.includes(w)) })
}
