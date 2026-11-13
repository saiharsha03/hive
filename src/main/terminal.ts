// The terminal drawer under each thread: one real shell (node-pty) per tab, owned here in the main process.
// It is for the person, not the agent. No Electron imports, so the session logic runs (and is tested) in plain Node.
import { execFileSync, spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import * as pty from 'node-pty'
import { currentSettings } from './settings'
import { IDLE_MS, hasBell, nextState, type AgentDef, type AgentState } from '../shared/agentThreadCore'

// raw output kept per tab, so a new view can catch up; the oldest output goes first
export const SCROLLBACK_CHARS = 512 * 1024

type Sink = { data: (id: string, chunk: string) => void; exit: (id: string, code: number, closed: boolean) => void; state?: (id: string, state: AgentState) => void }
// an agent thread's terminal also keeps its guessed state, the recent output it is read from, and the quiet timer
type Agent = { state: AgentState; tail: string; idle?: ReturnType<typeof setTimeout> }
// quiet: stopped for a restart, so the view keeps its place and hears nothing of the exit
type Term = { p: pty.IPty; buf: string; shell: string; cwd: string; closing: boolean; quiet?: boolean; agent?: Agent }

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
const isFile = (p: string) => { try { return statSync(p).isFile() } catch { return false } }

// An agent's command as node-pty starts it: found on PATH (or given as a path). On Windows an npm-style .cmd / .bat
// shim runs through cmd.exe with each argument quoted (and none that cmd would expand), a .ps1 one through PowerShell;
// otherwise the program itself with the arguments as a list. Nothing is joined into a shell line beyond that.
export function agentLaunch(command: string, args: string[], env: NodeJS.ProcessEnv = process.env, win = process.platform === 'win32', exists = isFile): { file: string; args: string[] | string } {
  const exts = win ? [...(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase()), '.ps1'] : ['']
  const tries = (base: string) => (win && exts.includes(extname(base).toLowerCase()) ? [base] : exts.map((e) => base + e))
  const isPath = /[\\/]/.test(command)
  const dirs = isPath ? [''] : (env.PATH ?? env.Path ?? '').split(win ? ';' : ':').filter(Boolean)
  const found = dirs.flatMap((d) => tries(d ? join(d, command) : command)).find(exists)
  if (!found) throw new Error(`${command} was not found${isPath ? '' : ' on PATH'}`)
  const ext = extname(found).toLowerCase()
  if (win && (ext === '.cmd' || ext === '.bat')) {
    const bad = args.find((a) => /["%!\r\n]/.test(a))
    if (bad !== undefined) throw new Error(`An argument for a ${ext} agent cannot contain " % ! or a line break: ${bad}`)
    return { file: env.ComSpec || 'cmd.exe', args: `/d /s /c ""${found}"${args.map((a) => ` "${a}"`).join('')}"` }
  }
  if (win && ext === '.ps1') {
    const shell = pickShell().file
    return { file: /(^|[\\/])(pwsh|powershell)(\.exe)?$/i.test(shell) ? shell : 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-File', found, ...args] }
  }
  return { file: found, args }
}
const agentDef = (name: string): AgentDef => {
  const def = (currentSettings()?.general.agents ?? []).find((a) => a.name === name)
  if (!def) throw new Error(`No agent named ${name} in Settings > Agents`)
  return def
}
const setAgentState = (id: string, a: Agent, next: AgentState) => { if (next !== a.state) { a.state = next; sink.state?.(id, next) } }
const size = (n: unknown, min: number, fallback: number) => (Number.isFinite(Number(n)) ? Math.max(min, Math.floor(Number(n))) : fallback)

// the tab's shell: started on first open, re-attached after that (same process, its output so far). With an agent's
// name (Settings > Agents) the terminal runs that agent instead of a shell, and reports its guessed state
export function openTerminal(id: string, cwd: string, cols: number, rows: number, agent?: string) {
  const have = terms.get(id)
  if (have) {
    have.p.resize(size(cols, 2, have.p.cols), size(rows, 1, have.p.rows))
    return { scrollback: have.buf, fresh: false, shell: have.shell, cwd: have.cwd, state: have.agent?.state }
  }
  const def = agent ? agentDef(agent) : null
  const { file, args } = def ? agentLaunch(def.command, def.args) : pickShell()
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
  const t: Term = { p, buf: '', shell: def ? def.command : file, cwd: dir, closing: false, ...(def ? { agent: { state: 'running' as const, tail: '' } } : {}) }
  terms.set(id, t)
  if (t.agent) sink.state?.(id, 'running')
  p.onData((chunk) => {
    if (t.quiet) return
    t.buf = trimScrollback(t.buf + chunk)
    sink.data(id, chunk)
    const a = t.agent
    if (!a) return
    a.tail = (a.tail + chunk).slice(-4096)
    setAgentState(id, a, nextState(a.state, hasBell(chunk) ? { type: 'bell' } : { type: 'output', tail: a.tail }))
    clearTimeout(a.idle)
    a.idle = setTimeout(() => setAgentState(id, a, nextState(a.state, { type: 'idle', ms: IDLE_MS, tail: a.tail })), IDLE_MS)
  })
  p.onExit(({ exitCode }) => {
    if (terms.get(id) === t) terms.delete(id)
    if (t.agent) { clearTimeout(t.agent.idle); if (!t.closing) setAgentState(id, t.agent, nextState(t.agent.state, { type: 'exit', code: exitCode })) }
    if (!t.quiet) sink.exit(id, exitCode, t.closing)
  })
  flushQueued(id, t)
  return { scrollback: '', fresh: true, shell: t.shell, cwd: dir, state: t.agent?.state }
}

// a line to type into a tab's shell: now when it is open, else as soon as it starts (an interactive Claude Code
// command the SDK cannot run, opened in the real CLI)
// A queued line older than a minute is dropped: the terminal it was for was never opened, and it must not fire into
// one opened later for something else
const queued = new Map<string, { line: string; at: number }>()
export function typeInTerminal(id: string, line: string) {
  const t = terms.get(id)
  if (t) t.p.write(`${line}\r`)
  else queued.set(id, { line, at: Date.now() })
}
const flushQueued = (id: string, t: Term) => {
  const q = queued.get(id)
  queued.delete(id)
  if (!q || Date.now() - q.at > 60_000) return
  setTimeout(() => { if (terms.get(id) === t) t.p.write(`${q.line}\r`) }, 800) // after the shell's first prompt
}

export function writeTerminal(id: string, data: string) {
  terms.get(id)?.p.write(String(data))
}

export function resizeTerminal(id: string, cols: number, rows: number) {
  const t = terms.get(id)
  if (t) try { t.p.resize(size(cols, 2, t.p.cols), size(rows, 1, t.p.rows)) } catch { /* exited meanwhile */ }
}

// the shell and everything started from it (a dev server, a watcher), so nothing is left running. quiet: for a restart,
// the view is not told (it opens the same id again at once)
export function killTerminal(id: string, quiet = false) {
  queued.delete(id)
  const t = terms.get(id)
  if (!t) return
  t.closing = true
  t.quiet = quiet
  if (t.agent) clearTimeout(t.agent.idle)
  terms.delete(id)
  // Windows: taskkill takes the whole tree, then kill() closes the pseudoconsole so its OpenConsole host exits too
  if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(t.p.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  try { t.p.kill() } catch { /* already gone */ }
}

export function killAllTerminals() {
  for (const id of [...terms.keys()]) killTerminal(id)
}

export const terminalPids = () => [...terms.values()].map((t) => t.p.pid)
