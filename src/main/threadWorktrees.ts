// Which worktrees each thread made through the worktree tool, kept in ~/.hive/hive-thread-worktrees.json so Hive can
// delete them when the thread is closed or archived, even after a restart. Keyed by the Claude session id.
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dataDir } from './testMode'
import { join } from 'node:path'
import { addLink, dropLinks, moveLinks, type LinkMap, type WorktreeLink } from '../shared/worktreeCore'
import { retireWorktree } from './devStack'
import { appName } from '../shared/appName'

const FILE = join(dataDir(), 'hive-thread-worktrees.json')

// a missing file is no links; a file that does not parse is an error, so it is never overwritten
async function read(): Promise<LinkMap> {
  let text: string
  try { text = await readFile(FILE, 'utf8') } catch (e: any) {
    if (e?.code === 'ENOENT') return {}
    throw e
  }
  try {
    const v = JSON.parse(text)
    if (v && typeof v === 'object' && !Array.isArray(v)) return v
  } catch { /* below */ }
  throw new Error(`${FILE} is not valid JSON; fix it before ${appName()} records or cleans up thread worktrees`)
}
async function write(map: LinkMap): Promise<void> {
  const tmp = `${FILE}.hive-tmp`
  await writeFile(tmp, JSON.stringify(map, null, 2) + '\n')
  await rename(tmp, FILE)
}

// one change at a time, so two tool calls never write over each other
let chain: Promise<unknown> = Promise.resolve()
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = chain.then(fn, fn)
  chain = next.catch(() => {})
  return next
}

export const linkThread = (thread: string, link: WorktreeLink) => serial(async () => write(addLink(await read(), thread, link)))

export const moveThreadLinks = (from: string, to: string) => serial(async () => {
  const map = await read()
  const n = map[from]?.length ?? 0
  if (n) await write(moveLinks(map, from, to))
  return n
})

export const threadLinks = async (thread: string): Promise<WorktreeLink[]> => (await read())[thread] ?? []

// the thread was closed or archived: delete each of its worktrees that still exists; returns one note per worktree
export const cleanupThread = (thread: string) => serial(async () => {
  const map = await read()
  const links = map[thread] ?? []
  if (!links.length) return []
  const notes: string[] = []
  const done: string[] = []
  for (const l of links) {
    const r = await retireWorktree(l)
    notes.push(r.note)
    if (r.done) done.push(l.path)
  }
  if (done.length) await write(dropLinks(map, thread, done))
  return notes
})
