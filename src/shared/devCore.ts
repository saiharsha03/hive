// Pull latest + Dev stack: pure logic (config parsing, repo scan rules, pull decisions, port / worktree / compose parsing,
// ownership and status decisions). No I/O besides path joins, so it can be tested without Electron.
// Everything workspace-specific (repo names, stacks, commands, ports) comes from Hive's .env, never from this file.
import { isAbsolute, join, resolve } from 'node:path'
import { appName } from './appName'

// ---------- .env ----------

// KEY=VALUE lines; # comments, optional "export ", single or double quotes around the value
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '').trim()
    if (!line || line.startsWith('#')) continue
    const m = line.replace(/^export\s+/, '').match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2]
    const q = v[0]
    // a quoted value ends at its closing quote; only a comment may follow it (KEY="a b" # note). Unquoted, a " #"
    // starts a comment, as in dotenv: a value that needs one is quoted
    const end = q === '"' || q === "'" ? v.indexOf(q, 1) : -1
    if (end > 0 && /^\s*(#.*)?$/.test(v.slice(end + 1))) v = v.slice(1, end)
    else if (end > 0 && v.endsWith(q)) v = v.slice(1, -1)
    else v = v.replace(/\s+#.*$/, '').trim()
    out[m[1]] = v
  }
  return out
}

// ---------- config (from Hive's .env) ----------

export type SvcDef = {
  key: string
  name: string // unique id shown in the panel and used by the agent tool
  label: string
  repo: string // folder name under the repos root
  kind: 'process' | 'docker'
  cmd: string // process: shell command run in the repo folder; {python} = the repo's venv python
  python: string // venv python path relative to the main checkout ('' = plain `python`)
  port: number | null
  open: boolean // web app: show an Open link
  env: Record<string, string> // defaults for the process; the repo's own env file wins over them
  envFile: string // env file in the repo folder, loaded into the process ('' = none)
  compose: string // docker: the compose service name
}
export type StackDef = { id: string; label: string; services: string[] }
export type DevConfig = {
  root: string
  agentsFolders: string[]
  pullSkip: string[]
  worktreesDir: string
  stacks: StackDef[]
  services: SvcDef[]
}

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const keyOf = (k: string) => k.toUpperCase().replace(/[^A-Z0-9]/g, '_')

export function parseDevConfig(env: Record<string, string>): { config: DevConfig | null; problems: string[] } {
  const problems: string[] = []
  const root = (env.HIVE_REPOS_ROOT ?? '').trim()
  if (!root) return { config: null, problems: ['HIVE_REPOS_ROOT is not set'] }
  // '' (the field cleared in Settings) is the default too: resolved against the root it would be the root itself,
  // and every worktree would land inside a main checkout
  const wt = (env.HIVE_WORKTREES_DIR ?? '').trim() || '.hive-worktrees'
  const services: SvcDef[] = []
  for (const key of list(env.HIVE_SERVICES)) {
    const p = `HIVE_SVC_${keyOf(key)}_`
    const g = (f: string) => (env[p + f] ?? '').trim()
    const kind = g('KIND') === 'docker' ? 'docker' : 'process'
    const repo = g('REPO')
    if (!repo) { problems.push(`${p}REPO is not set`); continue }
    if (kind === 'process' && !g('CMD')) { problems.push(`${p}CMD is not set`); continue }
    if (kind === 'docker' && !g('COMPOSE')) { problems.push(`${p}COMPOSE is not set`); continue }
    const port = Number(g('PORT'))
    const defaults: Record<string, string> = {}
    for (const pair of g('ENV').split(';')) {
      const i = pair.indexOf('=')
      if (i > 0) defaults[pair.slice(0, i).trim()] = pair.slice(i + 1).trim()
    }
    services.push({
      key, name: g('NAME') || key.toLowerCase(), label: g('LABEL') || g('NAME') || key, repo, kind, cmd: g('CMD'), python: g('PYTHON'),
      port: Number.isInteger(port) && port > 0 ? port : null, open: /^(1|true|yes)$/i.test(g('OPEN')), env: defaults,
      envFile: p + 'ENVFILE' in env ? g('ENVFILE') : '.env',
      compose: g('COMPOSE'),
    })
  }
  const byKey = new Map(services.map((s) => [keyOf(s.key), s.name]))
  const stacks: StackDef[] = []
  for (const id of list(env.HIVE_STACKS)) {
    const p = `HIVE_STACK_${keyOf(id)}_`
    const names: string[] = []
    for (const k of list(env[p + 'SERVICES'])) {
      const n = byKey.get(keyOf(k))
      if (n) names.push(n)
      else problems.push(`stack ${id}: unknown service ${k}`)
    }
    stacks.push({ id, label: (env[p + 'LABEL'] ?? '').trim() || id, services: names })
  }
  return {
    config: {
      root, agentsFolders: list(env.HIVE_AGENTS_FOLDERS), pullSkip: list(env.HIVE_PULL_SKIP).map((s) => s.replace(/\\/g, '/').toLowerCase()),
      worktreesDir: isAbsolute(wt) ? wt : resolve(root, wt), stacks, services,
    },
    problems,
  }
}

// ---------- Pull latest: which folders are scanned ----------

// "_" folders are archives, "." folders are tooling
export const scanName = (name: string) => !name.startsWith('_') && !name.startsWith('.')
// pullSkip entries are root-relative paths such as "some-repo/mirror"
export const skipped = (rel: string, skip: string[]) => skip.includes(rel.replace(/\\/g, '/').toLowerCase())
export const isAgentsFolder = (name: string, folders: string[]) => folders.some((f) => f.toLowerCase() === name.toLowerCase())

export type RepoFacts = {
  fetchError?: string
  dirty: boolean // tracked files modified or staged
  current: string | null // null = detached HEAD
  defaultBranch: string | null
  unpushed: number // commits on HEAD not on any remote branch
  behind: number // commits the default branch is behind origin
}
export type PullPlan = { action: 'skip' | 'none' | 'pull'; message: string; dry: string }

// origin/HEAD ("refs/remotes/origin/main"), else origin/main or origin/master if present
export function detectDefault(symRef: string | null, remoteBranches: string[]): string | null {
  const m = symRef?.trim().match(/^refs\/remotes\/origin\/(.+)$/)
  if (m) return m[1]
  for (const b of ['main', 'master']) if (remoteBranches.includes(b)) return b
  return null
}

export function planPull(f: RepoFacts): PullPlan {
  const skip = (m: string): PullPlan => ({ action: 'skip', message: m, dry: m })
  if (f.fetchError) return skip(`failed: ${f.fetchError}`)
  if (!f.defaultBranch) return skip('failed: could not tell the default branch (no origin/HEAD, main or master)')
  if (f.dirty) return skip('skipped: uncommitted changes')
  const cur = f.current ?? 'detached HEAD'
  const onDefault = f.current === f.defaultBranch
  if (!onDefault && f.unpushed > 0) return skip(`skipped: on branch ${cur} with unpushed commits`)
  const n = (c: number) => `${c} commit${c === 1 ? '' : 's'}`
  if (onDefault && f.behind === 0) return { action: 'none', message: 'already up to date', dry: 'already up to date' }
  const sw = onDefault ? '' : ` (switched from ${cur})`
  return {
    action: 'pull',
    message: f.behind === 0 ? `already up to date${sw}` : `updated ${n(f.behind)}${sw}`,
    dry: f.behind === 0 ? `would switch ${cur} to ${f.defaultBranch} (already up to date)` : `would ${onDefault ? '' : `switch ${cur} to ${f.defaultBranch} and `}pull ${n(f.behind)}`,
  }
}

// ---------- ports ----------

// Windows `netstat -ano -p tcp`: listening local port -> pid
export function parseListening(netstat: string): Map<number, number> {
  const out = new Map<number, number>()
  for (const line of netstat.split('\n')) {
    const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i)
    if (m) out.set(Number(m[1]), Number(m[2]))
  }
  return out
}

// ---------- worktrees ----------

export type Worktree = { path: string; branch: string | null; head: string }
export function parseWorktrees(porcelain: string): Worktree[] {
  const out: Worktree[] = []
  for (const block of porcelain.replace(/\r/g, '').split(/\n\n+/)) {
    const w: Worktree = { path: '', branch: null, head: '' }
    for (const l of block.split('\n')) {
      if (l.startsWith('worktree ')) w.path = l.slice(9).trim()
      else if (l.startsWith('HEAD ')) w.head = l.slice(5).trim()
      else if (l.startsWith('branch ')) w.branch = l.slice(7).trim().replace(/^refs\/heads\//, '')
    }
    if (w.path) out.push(w)
  }
  return out
}

const safeSeg = (s: string) => s.replace(/\//g, '__').replace(/[\\:*?"<>|\s]+/g, '_')
// <worktrees dir>/<repo>/<branch>, branch slashes flattened
export const worktreeDir = (base: string, repo: string, branch: string) => join(base, safeSeg(repo), safeSeg(branch))
export const validBranchName = (b: string) => /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(b) && !b.includes('..') && !b.endsWith('/') && !b.endsWith('.lock')

export type Source = { kind: 'main' } | { kind: 'worktree'; path: string } | { kind: 'branch'; branch: string }
export type SourceOption = { value: string; label: string; source: Source; path: string | null }
const samePath = (a: string, b: string) => a.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() === b.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
export { samePath }

// main checkout first, then the other worktrees, then local branches that are not checked out anywhere
export function sourceOptions(mainDir: string, worktrees: Worktree[], branches: string[]): SourceOption[] {
  const main = worktrees.find((w) => samePath(w.path, mainDir))
  const opts: SourceOption[] = [{ value: 'main', label: `main checkout (${main?.branch ?? 'detached'})`, source: { kind: 'main' }, path: mainDir }]
  for (const w of worktrees) {
    if (samePath(w.path, mainDir)) continue
    opts.push({ value: `wt:${w.path}`, label: `worktree ${w.branch ?? 'detached'}`, source: { kind: 'worktree', path: w.path }, path: w.path })
  }
  const taken = new Set(worktrees.map((w) => w.branch))
  for (const b of branches) if (!taken.has(b)) opts.push({ value: `br:${b}`, label: `branch ${b} (new worktree)`, source: { kind: 'branch', branch: b }, path: null })
  return opts
}

// ---------- ownership and start decisions ----------

export type Owner = { kind: 'user' } | { kind: 'thread'; id: string; title: string }
export const ownerLabel = (o: Owner | null) => (!o ? '' : o.kind === 'user' ? 'you' : o.title)
// the user can control anything Hive started; a thread only its own
export const canControl = (owner: Owner | null, caller: Owner): boolean =>
  caller.kind === 'user' || !owner || (owner.kind === 'thread' && owner.id === caller.id)

// keepRunning (the Stacks tab's Start): a service that came up since the tab last looked is left as it is, never
// restarted onto another folder
export function decideStart(i: { running: boolean; runningDir: string | null; owner: Owner | null; wantDir: string; caller: Owner; keepRunning?: boolean }):
  { act: 'start' | 'reuse' | 'restart' | 'busy'; msg: string } {
  if (!i.running) return { act: 'start', msg: '' }
  if (i.keepRunning) return { act: 'reuse', msg: `already running (started by ${ownerLabel(i.owner)}); left as it is` }
  if (i.runningDir && samePath(i.runningDir, i.wantDir)) return { act: 'reuse', msg: `already running from that folder (started by ${ownerLabel(i.owner)})` }
  if (canControl(i.owner, i.caller)) return { act: 'restart', msg: '' }
  return { act: 'busy', msg: `in use by ${ownerLabel(i.owner)}` }
}

export type SvcState = 'starting' | 'running' | 'failed' | 'stopped'
export function serviceState(i: { managed: null | { exited: boolean; code: number | null; stopping: boolean; spawnError?: string }; listening: boolean }):
  { state: SvcState; external: boolean; note: string } {
  const m = i.managed
  if (m && !m.exited) return { state: i.listening ? 'running' : 'starting', external: false, note: '' }
  if (m) {
    if (m.spawnError) return { state: 'failed', external: false, note: m.spawnError }
    if (m.stopping || m.code === 0) return { state: 'stopped', external: false, note: '' }
    return { state: 'failed', external: false, note: `exited with code ${m.code}` }
  }
  return i.listening ? { state: 'running', external: true, note: `running outside ${appName()}` } : { state: 'stopped', external: false, note: '' }
}

// `docker compose ps --format json`: one JSON object per line (or one array)
export function parseComposePs(text: string): Map<string, string> {
  const out = new Map<string, string>()
  const rows: any[] = []
  const t = text.trim()
  if (!t) return out
  try {
    const j = JSON.parse(t)
    rows.push(...(Array.isArray(j) ? j : [j]))
  } catch {
    for (const l of t.split('\n')) { try { rows.push(JSON.parse(l)) } catch { /* not json */ } }
  }
  for (const r of rows) if (r?.Service) out.set(String(r.Service), String(r.State ?? ''))
  return out
}

// ---------- logs ----------

// eslint-disable-next-line no-control-regex -- matching terminal escape codes is the point
export const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

// rolling buffer of the last `max` lines
export class LogBuffer {
  private lines: string[] = []
  private partial = ''
  constructor(private max = 5000) {}
  push(chunk: string) {
    const parts = (this.partial + stripAnsi(chunk).replace(/\r\n?/g, '\n')).split('\n')
    this.partial = parts.pop() ?? ''
    this.lines.push(...parts)
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max)
  }
  text(last?: number) {
    const all = this.partial ? [...this.lines, this.partial] : this.lines
    return (last ? all.slice(-last) : all).join('\n')
  }
}

// ---------- shared shapes (main -> UI) ----------

export type DevService = {
  name: string
  label: string
  repo: string
  kind: 'process' | 'docker'
  port: number | null
  open: boolean
  state: SvcState
  external: boolean
  note: string
  owner: string // '' when not started by Hive
  fromDir: string | null
  fromLabel: string
  startedAt: number
}
export type DevState = {
  configured: boolean
  message: string
  docker: { phase: 'unknown' | 'ready' | 'starting' | 'error'; message: string }
  stacks: StackDef[]
  services: DevService[]
}

export function formatStatus(services: DevService[], docker: DevState['docker']): string {
  const lines = [docker.phase === 'ready' ? 'Docker: running' : `Docker: ${docker.phase}${docker.message ? ` (${docker.message})` : ''}`]
  for (const s of services) {
    const bits = [s.state + (s.external ? ` (outside ${appName()})` : ''), s.port ? `port ${s.port}` : '', s.fromLabel ? `from ${s.fromLabel}` : '', s.owner ? `started by ${s.owner}` : '', s.note].filter(Boolean)
    lines.push(`${s.name}: ${bits.join(', ')}`)
  }
  return lines.join('\n')
}
