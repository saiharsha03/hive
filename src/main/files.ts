// One folder level for the Files panel: folders first, then files, case-insensitive (like VS Code).
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

export type Entry = { name: string; path: string; dir: boolean }

const HIDDEN = new Set(['.git']) // VS Code hides .git by default

export async function listDir(dir: string): Promise<Entry[]> {
  const items = await readdir(dir, { withFileTypes: true })
  return items
    .filter((d) => !HIDDEN.has(d.name))
    .map((d) => ({ name: d.name, path: join(dir, d.name), dir: d.isDirectory() }))
    .sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })))
}
