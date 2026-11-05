// The terminal drawer under each thread: one real shell (node-pty) per tab, owned here in the main process.
// It is for the person, not the agent. No Electron imports, so the session logic runs (and is tested) in plain Node.
import { execFileSync, spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import * as pty from 'node-pty'
import { currentSettings } from './settings'

// raw output kept per tab, so a new view can catch up; the oldest output goes first
export const SCROLLBACK_CHARS = 512 * 1024

type Sink = { data: (id: string, chunk: string) => void; exit: (id: string, code: number, closed: boolean) => void }
type Term = { p: pty.IPty; buf: string; shell: string; cwd: string; closing: boolean }

const terms = new Map<string, Term>()
let sink: Sink = { data: () => {}, exit: () => {} }
export const setTerminalSink = (s: Sink) => { sink = s }

// keep the newest `max` chars, cut at a line start so the view does not open mid-line
export function trimScrollback(buf: string, max = SCROLLBACK_CHARS): string {
  if (buf.length <= max) return buf
  const cut = buf.length - max
  const nl = buf.indexOf('\n', cut)
  return nl === -1 || nl - cut > 4096 ? buf.slice(cut) : buf.slice(nl + 1)
}

let shellCache: { file: string; args: string[] } | null = null
// PowerShell 7 if it is installed, else Windows PowerShell; the login shell elsewhere
export function pickShell(): { file: string; args: string[] } {
  const custom = currentSettings()?.general.shell // Settings > General; new terminals only
  if (custom) return { file: custom, args: /(^|[\\/])(pwsh|powershell)(\.exe)?$/i.test(custom) ? ['-NoLogo'] : [] }
  if (shellCache) return shellCache
  if (process.platform === 'win32') {
    let pwsh = false
    try { execFileSync('where.exe', ['pwsh'], { stdio: 'ignore', windowsHide: true }); pwsh = true } catch { /* not installed */ }
    shellCache = { file: pwsh ? 'pwsh.exe' : 'powershell.exe', args: ['-NoLogo'] }
  } else {
    shellCache = { file: process.env.SHELL || '/bin/bash', args: [] }
  }
  return shellCache
}

const isDir = (p: string) => { try { return !!p && statSync(p).isDirectory() } catch { return false } }
const size = (n: unknown, min: number, fallback: number) => (Number.isFinite(Number(n)) ? Math.max(min, Math.floor(Number(n))) : fallback)

// the tab's shell: started on first open, re-attached after that (same process, its output so far)
export function openTerminal(id: string, cwd: string, cols: number, rows: number) {
  const have = terms.get(id)
  if (have) {
    have.p.resize(size(cols, 2, have.p.cols), size(rows, 1, have.p.rows))
    return { scrollback: have.buf, fresh: false, shell: have.shell, cwd: have.cwd }
  }
  const { file, args } = pickShell()
  const dir = isDir(cwd) ? cwd : homedir()
  const p = pty.spawn(file, args, {
    name: 'xterm-256color',
    cols: size(cols, 2, 80),
    rows: size(rows, 1, 24),
    cwd: dir,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>,
    // node-pty's bundled ConPTY: its host exits with the shell (the system one stays behind after `exit`),
    // and kill() needs no console-list helper process
    useConptyDll: process.platform === 'win32',
  })
  const t: Term = { p, buf: '', shell: file, cwd: dir, closing: false }
  terms.set(id, t)
  p.onData((chunk) => {
    t.buf = trimScrollback(t.buf + chunk)
    sink.data(id, chunk)
  })
  p.onExit(({ exitCode }) => {
    if (terms.get(id) === t) terms.delete(id)
    sink.exit(id, exitCode, t.closing)
  })
  flushQueued(id, t)
  return { scrollback: '', fresh: true, shell: file, cwd: dir }
}

// a line to type into a tab's shell: now when it is open, else as soon as it starts (an interactive Claude Code
// command the SDK cannot run, opened in the real CLI)
const queued = new Map<string, string>()
export function typeInTerminal(id: string, line: string) {
  const t = terms.get(id)
  if (t) t.p.write(`${line}\r`)
  else queued.set(id, line)
}
const flushQueued = (id: string, t: Term) => {
  const line = queued.get(id)
  if (!line) return
  queued.delete(id)
  setTimeout(() => { if (terms.get(id) === t) t.p.write(`${line}\r`) }, 800) // after the shell's first prompt
}

export function writeTerminal(id: string, data: string) {
  terms.get(id)?.p.write(String(data))
}

export function resizeTerminal(id: string, cols: number, rows: number) {
  const t = terms.get(id)
  if (t) try { t.p.resize(size(cols, 2, t.p.cols), size(rows, 1, t.p.rows)) } catch { /* exited meanwhile */ }
}

// the shell and everything started from it (a dev server, a watcher), so nothing is left running
export function killTerminal(id: string) {
  const t = terms.get(id)
  if (!t) return
  t.closing = true
  terms.delete(id)
  // Windows: taskkill takes the whole tree, then kill() closes the pseudoconsole so its OpenConsole host exits too
  if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(t.p.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  try { t.p.kill() } catch { /* already gone */ }
}

export function killAllTerminals() {
  for (const id of [...terms.keys()]) killTerminal(id)
}

export const terminalPids = () => [...terms.values()].map((t) => t.p.pid)
