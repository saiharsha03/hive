// Scripts panel, main process: plain commands, no Claude. Each button in the local scripts.json runs one command in its
// folder with the user's own environment and streams the output; Stop kills the process tree. The UI only names a
// script and an option: the command always comes from the settings store (or the file), never from the page.
// The list lives in the settings store (seeded from scripts.json); the file is only the fallback when the store has none.
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { LogBuffer } from '../shared/devCore'
import { findMatches, logStem, parseScriptsConfig, pickNewest, viewScript, type Entry, type ScriptDef, type ScriptRun, type ScriptView } from '../shared/scriptsCore'
import { blocked, dataDir, TEST_MODE } from './testMode'

const TAIL = 400 // lines kept for the panel; the log file has everything

let file = ''
let stored: () => unknown[] | null = () => null // the settings store's list, read on every call
let send: (runs: ScriptRun[]) => void = () => {}
let logDir = join(dataDir(), 'hive', 'scripts')
const runs = new Map<string, ScriptRun>() // script name -> its latest run
const procs = new Map<string, { child: ChildProcess; stopping: boolean }>()

// scripts.json sits next to Hive's .env (HIVE_SCRIPTS_FILE overrides, for tests)
export function initScripts(appDir: string, onUpdate: (runs: ScriptRun[]) => void, logs?: string, fromSettings?: () => unknown[] | null) {
  file = process.env.HIVE_SCRIPTS_FILE || join(appDir, 'scripts.json')
  if (fromSettings) stored = fromSettings
  send = onUpdate
  if (logs) logDir = logs
}

// read on every call, so edits to the file show up without restarting Hive
function load(): { scripts: ScriptDef[]; message: string } {
  const list = stored()
  if (list) {
    const parsed = parseScriptsConfig(JSON.stringify(list))
    return { scripts: parsed.scripts, message: parsed.problems.length ? `Problems in the Scripts settings: ${parsed.problems.join('; ')}` : '' }
  }
  if (!existsSync(file)) return { scripts: [], message: `No scripts.json found at ${file}. Copy scripts.example.json to scripts.json and list your scripts.` }
  let parsed
  try {
    parsed = parseScriptsConfig(readFileSync(file, 'utf8'))
  } catch (e) {
    return { scripts: [], message: `Could not read ${file}: ${(e as Error).message}` }
  }
  const message = parsed.problems.length ? `Problems in ${file}: ${parsed.problems.join('; ')}. See scripts.example.json.` : ''
  return { scripts: parsed.scripts, message }
}

export function scriptsConfig(): { scripts: ScriptView[]; message: string; path: string } {
  const l = load()
  return { scripts: l.scripts.map((s) => viewScript(s, existsSync)), message: l.message, path: file }
}

export const scriptsState = () => [...runs.values()]

let pending: ReturnType<typeof setTimeout> | null = null
function publish() {
  if (pending) return
  pending = setTimeout(() => { pending = null; send(scriptsState()) }, 150)
}
const patch = (name: string, id: string, p: Partial<ScriptRun>) => {
  const r = runs.get(name)
  if (r && r.id === id) { runs.set(name, { ...r, ...p }); publish() }
}

// real folders only: links and junctions count as files, so ** never loops
const lister = (dir: string): Entry[] => readdirSync(dir, { withFileTypes: true }).map((e) => {
  let mtime = 0
  if (!e.isDirectory()) try { mtime = statSync(join(dir, e.name)).mtimeMs } catch { /* gone meanwhile */ }
  return { name: e.name, dir: e.isDirectory(), mtime }
})

export function runScript(name: string, label: string): string {
  const def = load().scripts.find((s) => s.name === name)
  if (!def) throw new Error(`No script named "${name}" in ${file}`)
  const opt = def.options.find((o) => o.label === label)
  if (!opt) throw new Error(`"${name}" has no option "${label}"`)
  if (procs.has(name)) throw new Error(`"${name}" is already running`)
  const view = viewScript(def, existsSync)
  const missing = view.missing || view.options.find((o) => o.label === label)!.missing
  if (missing) throw new Error(missing)

  const startedAt = Date.now()
  const id = `${startedAt}`
  mkdirSync(logDir, { recursive: true })
  const log = join(logDir, `${logStem(name, startedAt)}.log`)
  const out = createWriteStream(log)
  const tail = new LogBuffer(TAIL)
  const head = `$ ${opt.cmd}   (in ${def.cwd})\n`
  out.write(head)
  tail.push(head)
  runs.set(name, { id, name, label, cmd: opt.cmd, phase: 'running', code: null, startedAt, output: tail.text(), log, note: '' })
  publish()

  // test mode: echo the command, never run it
  if (TEST_MODE) {
    const t = `${blocked('running scripts')}\necho ${opt.cmd}\n`
    out.end(t)
    tail.push(t)
    patch(name, id, { output: tail.text(), endedAt: Date.now(), phase: 'ok', code: 0, note: 'test mode: echo only' })
    return id
  }
  // the user's own environment (DB settings etc.); Python told to flush as it goes and to write UTF-8 into the pipe
  const child = spawn(opt.cmd, { cwd: def.cwd, shell: true, windowsHide: true, detached: process.platform !== 'win32', env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' } })
  const p = { child, stopping: false }
  procs.set(name, p)
  const stream = (s: NodeJS.ReadableStream | null) => {
    const dec = new StringDecoder('utf8')
    s?.on('data', (b: Buffer) => { const t = dec.write(b); out.write(t); tail.push(t); patch(name, id, { output: tail.text() }) })
  }
  stream(child.stdout)
  stream(child.stderr)
  let ended = false
  const end = (r: Partial<ScriptRun>) => {
    if (ended) return
    ended = true
    procs.delete(name)
    out.end()
    patch(name, id, { output: tail.text(), endedAt: Date.now(), ...r })
  }
  child.on('error', (e) => end({ phase: 'failed', note: `could not start: ${e.message}` }))
  child.on('close', (code, signal) => {
    if (p.stopping) return end({ phase: 'stopped', code, note: 'stopped' })
    if (code !== 0) return end({ phase: 'failed', code, note: signal ? `killed (${signal})` : `exit ${code}` })
    let opened: string | undefined
    let note = 'exit 0'
    if (def.open) {
      const f = pickNewest(findMatches(def.cwd, def.open, lister))
      if (!f) note = `exit 0; nothing matches ${def.open}`
      else {
        opened = f.path
        if (f.mtime < startedAt) note = `exit 0; the newest match is from before this run`
      }
    }
    end({ phase: 'ok', code, note, opened })
  })
  return id
}

const killTree = (c: ChildProcess) => {
  if (!c.pid) return
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(c.pid), '/T', '/F'], { windowsHide: true }, () => {})
  // elsewhere the script runs in its own process group (detached), so the shell and everything it started go together
  else { try { process.kill(-c.pid!, 'SIGKILL') } catch { c.kill('SIGKILL') } }
}

export function stopScript(name: string) {
  const p = procs.get(name)
  if (!p) return
  p.stopping = true
  killTree(p.child)
}

// Hive is closing: no script keeps running without a window to show or stop it
export function stopAllScripts() {
  for (const name of procs.keys()) stopScript(name)
}
