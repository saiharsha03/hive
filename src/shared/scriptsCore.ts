// Scripts panel: pure logic (config parsing, the "open" glob, picking the newest match, missing-file notes).
// No I/O of its own (the folder lister and exists check are passed in), so it can be tested without Electron.
// The scripts themselves come from Orbit's local scripts.json (git ignores it), never from this file.
import { isAbsolute, join } from 'node:path'

export type ScriptOption = { label: string; cmd: string }
export type ScriptDef = { name: string; cwd: string; options: ScriptOption[]; open?: string }

// main -> UI: a script as the panel shows it, with what is missing on disk
export type ScriptView = { name: string; cwd: string; open?: string; missing: string; options: (ScriptOption & { missing: string })[] }

export type ScriptPhase = 'running' | 'ok' | 'failed' | 'stopped'
export type ScriptRun = {
  id: string
  name: string
  label: string
  cmd: string
  phase: ScriptPhase
  code: number | null
  startedAt: number
  endedAt?: number
  output: string // the tail; the full output is in log
  log: string
  opened?: string // the file the run opened in the preview panel
  note: string
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const absolute = (p: string) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/')

// a relative glob: forward or back slashes, no drive, no "..", no empty segments
export function globSegments(glob: string): string[] | null {
  const segs = glob.trim().split(/[\\/]+/)
  if (!glob.trim() || absolute(glob.trim()) || segs.some((s) => s === '' || s === '.' || s === '..')) return null
  return segs
}

// scripts.json: an array of { name, cwd, options: [{ label, cmd }], open? }. Bad entries are skipped with a problem each.
export function parseScriptsConfig(text: string): { scripts: ScriptDef[]; problems: string[] } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { scripts: [], problems: [`not valid JSON (${(e as Error).message})`] }
  }
  if (!Array.isArray(raw)) return { scripts: [], problems: ['the file must be a JSON array of scripts'] }
  const scripts: ScriptDef[] = []
  const problems: string[] = []
  raw.forEach((s, i) => {
    const at = `entry ${i + 1}`
    if (!s || typeof s !== 'object') return problems.push(`${at} is not an object`)
    const o = s as Record<string, unknown>
    const name = str(o.name)
    if (!name) return problems.push(`${at} has no name`)
    if (scripts.some((x) => x.name.toLowerCase() === name.toLowerCase())) return problems.push(`"${name}" is listed twice`)
    const cwd = str(o.cwd)
    if (!cwd || !absolute(cwd)) return problems.push(`"${name}": cwd must be an absolute folder path`)
    if (!Array.isArray(o.options) || !o.options.length) return problems.push(`"${name}": options must be a non-empty array`)
    const options: ScriptOption[] = []
    for (const op of o.options as unknown[]) {
      const label = str((op as Record<string, unknown>)?.label)
      const cmd = str((op as Record<string, unknown>)?.cmd)
      if (!label || !cmd) return problems.push(`"${name}": every option needs a label and a cmd`)
      if (options.some((x) => x.label === label)) return problems.push(`"${name}": option "${label}" is listed twice`)
      options.push({ label, cmd })
    }
    const def: ScriptDef = { name, cwd, options }
    if (o.open !== undefined) {
      const open = str(o.open)
      if (!globSegments(open)) return problems.push(`"${name}": open must be a glob relative to cwd (no drive, no "..")`)
      def.open = open
    }
    scripts.push(def)
  })
  return { scripts, problems }
}

// one path segment of the glob: * = anything but a slash, ? = one character; case-insensitive (Windows paths)
export function segmentRegex(seg: string): RegExp {
  const body = seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^\\\\/]*').replace(/\?/g, '[^\\\\/]')
  return new RegExp(`^${body}$`, 'i')
}

export type Entry = { name: string; dir: boolean; mtime: number }
export type Lister = (dir: string) => Entry[]

// every file under root matching the glob (** = any number of folders). The lister reports links and junctions as
// non-folders, so ** never follows one into a loop.
export function findMatches(root: string, glob: string, list: Lister): { path: string; mtime: number }[] {
  const segs = globSegments(glob)
  if (!segs) return []
  const out: { path: string; mtime: number }[] = []
  const walk = (dir: string, rest: string[]) => {
    let entries: Entry[]
    try { entries = list(dir) } catch { return }
    const [seg, ...after] = rest
    if (seg === '**') {
      walk(dir, after.length ? after : ['*']) // zero folders
      for (const e of entries) if (e.dir) walk(join(dir, e.name), rest)
      return
    }
    const re = segmentRegex(seg)
    for (const e of entries) {
      if (!re.test(e.name)) continue
      if (!after.length && !e.dir) out.push({ path: join(dir, e.name), mtime: e.mtime })
      else if (after.length && e.dir) walk(join(dir, e.name), after)
    }
  }
  walk(root, segs)
  return out
}

// newest by modified time; a tie goes to the later path name
export function pickNewest(files: { path: string; mtime: number }[]): { path: string; mtime: number } | null {
  let best: { path: string; mtime: number } | null = null
  for (const f of files) if (!best || f.mtime > best.mtime || (f.mtime === best.mtime && f.path > best.path)) best = f
  return best
}

// the script file a command runs, when it names one ("python main.py --x" -> main.py), else null
export function scriptFile(cmd: string): string | null {
  const m = cmd.trim().match(/^(?:"[^"]+"|\S+)\s+(?:"([^"]+)"|(\S+))/)
  const f = m ? m[1] ?? m[2] : null
  return f && /\.(py|js|mjs|cjs|ts|ps1|sh|bat|cmd|rb)$/i.test(f) ? f : null
}

// what the panel says is missing: the folder, or per option the script file it names
export function viewScript(def: ScriptDef, exists: (p: string) => boolean): ScriptView {
  const folder = exists(def.cwd)
  return {
    name: def.name, cwd: def.cwd, open: def.open,
    missing: folder ? '' : `Folder not found: ${def.cwd}`,
    options: def.options.map((o) => {
      const f = scriptFile(o.cmd)
      const path = f && (isAbsolute(f) ? f : join(def.cwd, f))
      return { ...o, missing: folder && path && !exists(path) ? `Script not found: ${path}` : '' }
    }),
  }
}

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

// a file-name-safe stem for the run's log
export const logStem = (name: string, at: number) => {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'script'}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
