// Dev stack, main process: plain code, no Claude. Starts the services a stack lists in Hive's .env (docker compose
// services and local dev processes), tracks their status / port / logs / owner, and lets each process run from the main
// checkout, an existing git worktree, or a new worktree for a local branch.
// The same engine backs the panel (IPC) and the agent tool in chat.ts, which gets guard rails through the `caller`.
import { BrowserWindow } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, unlinkSync } from 'node:fs'
import { connect } from 'node:net'
import { dirname, join } from 'node:path'
import {
  LogBuffer, canControl, decideStart, detectDefault, formatStatus, ownerLabel, parseComposePs, parseEnvFile, parseListening, parseWorktrees, samePath, serviceState,
  sourceOptions, validBranchName, worktreeDir,
  type DevConfig, type DevService, type DevState, type Owner, type Source, type SourceOption, type SvcDef,
} from '../shared/devCore'
import type { Loaded } from './devConfig'
import { WIP_MESSAGE, decideCleanup, envCopies, hasWork, planWorktree, validRepoName, type WorktreeLink } from '../shared/worktreeCore'
import { appName } from '../shared/appName'

export type { Owner, Source }
export const USER: Owner = { kind: 'user' }

const DOCKER_EXE = process.env.HIVE_DOCKER_DESKTOP || 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'
const DOCKER_WAIT_MS = 120_000

type Proc = { child: ChildProcess | null; dir: string; fromLabel: string; owner: Owner; startedAt: number; exited: boolean; code: number | null; stopping: boolean; spawnError?: string; log: LogBuffer }

let loaded: Loaded = { config: null, message: 'Not loaded', path: '', env: {} }
const procs = new Map<string, Proc>()
const titles = new Map<string, string>()
const dockerCache = new Map<string, string>() // service name -> compose state
const dockerBusy = new Map<string, { state: 'starting' | 'failed'; note: string }>()
const dockerLogs = new Map<string, LogBuffer>()
let docker: DevState['docker'] = { phase: 'unknown', message: '' }
let listening = new Map<number, number>()
let ensuring: Promise<void> | null = null
let lastJson = ''

const cfg = (): DevConfig => {
  if (!loaded.config) throw new Error(loaded.message)
  return loaded.config
}
const svcByName = (name: string) => {
  const s = cfg().services.find((x) => x.name === name)
  if (!s) throw new Error(`Unknown service ${name}. Known: ${cfg().services.map((x) => x.name).join(', ')}`)
  return s
}
const repoDir = (repo: string) => join(cfg().root, repo)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const run = (cmd: string, args: string[], opts: { cwd?: string; timeout?: number } = {}) =>
  new Promise<string>((ok, bad) => {
    execFile(cmd, args, { cwd: opts.cwd, timeout: opts.timeout ?? 60_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => (err ? bad(new Error((stderr || err.message).toString().trim().split('\n').slice(-3).join(' | '))) : ok(stdout.toString())))
  })
const git = (dir: string, args: string[]) => run('git', args, { cwd: dir })

// ---------- publishing ----------

const label = (o: Owner | null): string => (o && o.kind === 'thread' ? ownerLabel({ ...o, title: titles.get(o.id) ?? o.title }) : ownerLabel(o))
let pending: ReturnType<typeof setTimeout> | null = null
function publish() {
  if (pending) return
  pending = setTimeout(() => {
    pending = null
    const s = snapshot()
    const json = JSON.stringify(s)
    if (json === lastJson) return
    lastJson = json
    for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('dev:update', s)
  }, 120)
}

// called again when the settings change: new starts use the new config, running services keep theirs
let started = false
export function init(l: Loaded) {
  loaded = l
  if (started) return
  started = true
  setInterval(() => {
    if (![...procs.values()].some((p) => !p.exited)) return
    void refreshPorts().then(publish)
  }, 2000).unref()
}

export function snapshot(): DevState {
  const c = loaded.config
  if (!c) return { configured: false, message: loaded.message, docker, stacks: [], services: [] }
  const services: DevService[] = c.services.map((s) => {
    const base = { name: s.name, label: s.label, repo: s.repo, kind: s.kind, port: s.port, open: s.open }
    if (s.kind === 'docker') {
      const busy = dockerBusy.get(s.name)
      const st = dockerCache.get(s.name)
      const state = busy ? busy.state : st === 'running' ? 'running' : 'stopped'
      return { ...base, state, external: false, note: busy?.note ?? (st && st !== 'running' ? st : ''), owner: '', fromDir: null, fromLabel: 'main checkout', startedAt: 0 } as DevService
    }
    const p = procs.get(s.name)
    const st = serviceState({ managed: p ?? null, listening: s.port ? listening.has(s.port) : true })
    return { ...base, ...st, owner: p && !p.exited ? label(p.owner) : '', fromDir: p?.dir ?? null, fromLabel: p?.fromLabel ?? '', startedAt: p?.startedAt ?? 0 }
  })
  return { configured: true, message: loaded.message, docker, stacks: c.stacks, services }
}

// ---------- ports / docker state ----------

async function refreshPorts() {
  if (!loaded.config) return
  if (process.platform === 'win32') {
    try { listening = parseListening(await run('netstat', ['-ano', '-p', 'tcp'], { timeout: 15_000 })) } catch { /* keep the last reading */ }
    return
  }
  const next = new Map<number, number>()
  await Promise.all(loaded.config.services.filter((s) => s.port).map((s) => new Promise<void>((done) => {
    const sock = connect({ port: s.port!, host: '127.0.0.1' }, () => { next.set(s.port!, 0); sock.destroy(); done() })
    sock.on('error', () => done())
  })))
  listening = next
}

let okAt = 0
let okVal = false
async function dockerOk(fresh = false): Promise<boolean> {
  if (!fresh && Date.now() - okAt < 4000) return okVal
  okVal = await run('docker', ['info'], { timeout: 20_000 }).then(() => true).catch(() => false)
  okAt = Date.now()
  if (okVal && docker.phase !== 'starting') docker = { phase: 'ready', message: '' }
  else if (!okVal && docker.phase === 'ready') docker = { phase: 'unknown', message: '' }
  return okVal
}

// the live picture for the panel: ports, docker daemon and container states
export async function status(): Promise<DevState> {
  if (!loaded.config) return snapshot()
  await refreshPorts()
  const dockerSvcs = loaded.config.services.filter((s) => s.kind === 'docker')
  if (dockerSvcs.length && (await dockerOk())) {
    for (const repo of new Set(dockerSvcs.map((s) => s.repo))) {
      try {
        const ps = parseComposePs(await run('docker', ['compose', 'ps', '-a', '--format', 'json'], { cwd: repoDir(repo), timeout: 30_000 }))
        for (const s of dockerSvcs.filter((x) => x.repo === repo)) dockerCache.set(s.name, ps.get(s.compose) ?? 'not created')
      } catch { /* leave the last state */ }
    }
  } else dockerCache.clear()
  return snapshot()
}

async function ensureDocker(): Promise<void> {
  if (await dockerOk(true)) return
  if (ensuring) return ensuring
  ensuring = (async () => {
    docker = { phase: 'starting', message: 'Starting Docker…' }
    publish()
    if (!existsSync(DOCKER_EXE)) {
      docker = { phase: 'error', message: `Docker is not running and Docker Desktop was not found at ${DOCKER_EXE}` }
      throw new Error(docker.message)
    }
    spawn(DOCKER_EXE, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref()
    const end = Date.now() + DOCKER_WAIT_MS
    while (Date.now() < end) {
      await sleep(3000)
      if (await dockerOk(true)) { docker = { phase: 'ready', message: '' }; publish(); return }
    }
    docker = { phase: 'error', message: `Docker Desktop did not become ready within ${DOCKER_WAIT_MS / 60000} minutes. Start it by hand and try again.` }
    publish()
    throw new Error(docker.message)
  })().finally(() => { ensuring = null })
  return ensuring
}

// ---------- where a service runs from ----------

async function worktrees(repo: string) {
  return parseWorktrees(await git(repoDir(repo), ['worktree', 'list', '--porcelain']))
}

export async function sources(repo: string): Promise<SourceOption[]> {
  const main = repoDir(repo)
  const wts = await worktrees(repo)
  return sourceOptions(main, wts, await refNames(main, 'refs/heads'))
}

// short names of the refs under one namespace (local branches: refs/heads)
const refNames = async (dir: string, ns: string) =>
  (await git(dir, ['for-each-ref', '--format=%(refname:short)', ns])).split('\n').map((s) => s.trim()).filter(Boolean)

// .env files and node_modules are not in git: carry them into a fresh worktree so the dev command works there
function prepareWorktree(main: string, wt: string) {
  for (const f of readdirSync(main)) {
    if (/^\.env/.test(f) && !existsSync(join(wt, f))) { try { copyFileSync(join(main, f), join(wt, f)) } catch { /* not a file */ } }
  }
  const nm = join(main, 'node_modules')
  if (existsSync(nm) && !existsSync(join(wt, 'node_modules'))) { try { symlinkSync(nm, join(wt, 'node_modules'), 'junction') } catch { /* optional */ } }
}

async function resolveDir(repo: string, src: Source): Promise<{ dir: string; label: string }> {
  const main = repoDir(repo)
  if (!existsSync(main)) throw new Error(`${repo} not found at ${main}`)
  const wts = await worktrees(repo)
  const mainWt = wts.find((w) => samePath(w.path, main))
  if (src.kind === 'main') return { dir: main, label: `main checkout (${mainWt?.branch ?? 'detached'})` }
  if (src.kind === 'worktree') {
    const w = wts.find((x) => samePath(x.path, src.path))
    if (!w) throw new Error(`${src.path} is not a worktree of ${repo}`)
    return { dir: w.path, label: samePath(w.path, main) ? `main checkout (${w.branch ?? 'detached'})` : `worktree ${w.branch ?? 'detached'}` }
  }
  const b = src.branch
  if (!validBranchName(b)) throw new Error(`Not a valid branch name: ${b}`)
  const have = wts.find((w) => w.branch === b)
  if (have) return { dir: have.path, label: samePath(have.path, main) ? `main checkout (${b})` : `worktree ${b}` }
  await git(main, ['rev-parse', '--verify', '-q', `refs/heads/${b}`]).catch(() => { throw new Error(`${repo} has no local branch ${b}`) })
  return { dir: await addWorktree(repo, b), label: `worktree ${b}` }
}

// a new worktree under the worktree root for a local branch, or (with `base`) for a new branch made from base
async function addWorktree(repo: string, branch: string, base?: string): Promise<string> {
  const main = repoDir(repo)
  const target = worktreeDir(cfg().worktreesDir, repo, branch)
  if (existsSync(target)) throw new Error(`${target} already exists but is not a worktree of ${repo} on ${branch}; move it away first`)
  mkdirSync(dirname(target), { recursive: true })
  // --no-track: the new branch must not follow origin/main, so a push never goes there
  await git(main, base ? ['worktree', 'add', '--no-track', '-b', branch, target, base] : ['worktree', 'add', target, branch])
  prepareWorktree(main, target)
  return target
}

// ---------- processes ----------

const killTree = (p: ChildProcess) => {
  if (!p.pid) return
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }, () => {})
  else { try { process.kill(-p.pid, 'SIGTERM') } catch { p.kill() } }
}

async function stopProc(p: Proc, port: number | null) {
  if (p.exited || !p.child) return
  p.stopping = true
  const done = new Promise<void>((r) => p.child!.once('close', () => r()))
  killTree(p.child)
  await Promise.race([done, sleep(8000)])
  for (let i = 0; port && i < 16; i++) {
    await refreshPorts()
    if (!listening.has(port)) break
    await sleep(500)
  }
}

async function startProc(svc: SvcDef, src: Source, caller: Owner): Promise<string> {
  const { dir, label: from } = await resolveDir(svc.repo, src)
  await refreshPorts()
  const old = procs.get(svc.name)
  const d = decideStart({ running: !!old && !old.exited, runningDir: old?.dir ?? null, owner: old?.owner ?? null, wantDir: dir, caller })
  if (d.act === 'busy') throw new Error(d.msg)
  if (d.act === 'reuse') return `${svc.name}: ${d.msg}`
  if (d.act === 'restart') await stopProc(old!, svc.port)
  if (svc.port) {
    await refreshPorts()
    if (listening.has(svc.port)) {
      const other = [...procs.entries()].find(([n, p]) => n !== svc.name && !p.exited && cfg().services.find((x) => x.name === n)?.port === svc.port)
      throw new Error(`port ${svc.port} is already in use (${other ? `by ${other[0]}` : `outside ${appName()}, pid ${listening.get(svc.port)}`}); not starting a second copy`)
    }
  }
  const main = repoDir(svc.repo)
  const py = svc.python ? join(main, svc.python) : ''
  const cmd = svc.cmd.split('{python}').join(py && existsSync(py) ? py : 'python')
  const envPath = svc.envFile ? [join(dir, svc.envFile), join(main, svc.envFile)].find((f) => existsSync(f)) : undefined
  const env = { ...process.env, PYTHONUNBUFFERED: '1', FORCE_COLOR: '0', BROWSER: 'none', ...svc.env, ...(envPath ? parseEnvFile(readFileSync(envPath, 'utf8')) : {}) }
  const p: Proc = { child: null, dir, fromLabel: from, owner: caller, startedAt: Date.now(), exited: false, code: null, stopping: false, log: new LogBuffer() }
  procs.set(svc.name, p)
  p.log.push(`$ ${cmd}   (in ${dir})\n`)
  try {
    const child = spawn(cmd, { cwd: dir, shell: true, env, windowsHide: true, detached: process.platform !== 'win32' })
    p.child = child
    child.stdout?.on('data', (b) => { p.log.push(b.toString()) })
    child.stderr?.on('data', (b) => { p.log.push(b.toString()) })
    child.on('error', (e) => { p.exited = true; p.spawnError = `could not start: ${e.message}`; publish() })
    child.on('close', (code) => { p.exited = true; p.code = code; p.log.push(`\n[exited with code ${code}]\n`); publish() })
  } catch (e) {
    p.exited = true
    p.spawnError = `could not start: ${(e as Error).message}`
  }
  publish()
  return `${svc.name}: starting from ${from}`
}

// ---------- public operations ----------

const dockerGroups = (defs: SvcDef[]) => {
  const g = new Map<string, SvcDef[]>()
  for (const s of defs.filter((x) => x.kind === 'docker')) g.set(s.repo, [...(g.get(s.repo) ?? []), s])
  return g
}
const logDocker = (name: string, text: string) => {
  const b = dockerLogs.get(name) ?? new LogBuffer()
  dockerLogs.set(name, b)
  b.push(text.endsWith('\n') ? text : text + '\n')
}

async function dockerUp(defs: SvcDef[]): Promise<string[]> {
  const lines: string[] = []
  await Promise.all([...dockerGroups(defs)].map(async ([repo, ds]) => {
    for (const s of ds) dockerBusy.set(s.name, { state: 'starting', note: '' })
    publish()
    try {
      const out = await run('docker', ['compose', 'up', '-d', ...ds.map((s) => s.compose)], { cwd: repoDir(repo), timeout: 20 * 60_000 })
      for (const s of ds) { dockerBusy.delete(s.name); dockerCache.set(s.name, 'running'); logDocker(s.name, `up -d ${s.compose}: ok ${out.trim()}`) }
      lines.push(`docker (${repo}): up ${ds.map((s) => s.name).join(', ')}`)
    } catch (e) {
      const m = (e as Error).message
      for (const s of ds) { dockerBusy.set(s.name, { state: 'failed', note: m }); logDocker(s.name, `up -d failed: ${m}`) }
      lines.push(`docker (${repo}): failed to start ${ds.map((s) => s.name).join(', ')}: ${m}`)
    }
    publish()
  }))
  return lines
}

export async function startStack(stackId: string, srcs: Record<string, Source>, caller: Owner): Promise<string[]> {
  const stack = cfg().stacks.find((s) => s.id === stackId)
  if (!stack) throw new Error(`Unknown stack ${stackId}. Known: ${cfg().stacks.map((s) => s.id).join(', ')}`)
  const defs = stack.services.map(svcByName)
  const lines: string[] = []
  if (defs.some((s) => s.kind === 'docker')) {
    try { await ensureDocker() } catch (e) { return [`Docker: ${(e as Error).message}`] }
    lines.push(...(await dockerUp(defs)))
  }
  await Promise.all(defs.filter((s) => s.kind === 'process').map((s) =>
    startProc(s, srcs[s.repo] ?? { kind: 'main' }, caller).then((m) => lines.push(m)).catch((e) => lines.push(`${s.name}: not started: ${(e as Error).message}`))))
  return lines
}

// one process service, from a chosen source (the panel's Start / Run from)
export async function startService(name: string, src: Source, caller: Owner): Promise<string> {
  const s = svcByName(name)
  if (s.kind === 'docker') {
    await ensureDocker()
    return (await dockerUp([s])).join('\n')
  }
  return startProc(s, src, caller)
}

export async function stopService(name: string, caller: Owner): Promise<string> {
  const s = svcByName(name)
  if (s.kind === 'docker') {
    if (caller.kind !== 'user') return `${name}: shared database service; stop it from the Dev stack panel`
    await run('docker', ['compose', 'stop', s.compose], { cwd: repoDir(s.repo), timeout: 120_000 })
    dockerCache.set(name, 'exited')
    publish()
    return `${name}: stopped`
  }
  const p = procs.get(name)
  if (!p || p.exited) return `${name}: not running by ${appName()}`
  if (!canControl(p.owner, caller)) return `${name}: in use by ${label(p.owner)}; not stopped`
  await stopProc(p, s.port)
  publish()
  return `${name}: stopped`
}

// the user's Stop all also stops the docker services; a thread's only stops its own processes
export async function stopAll(caller: Owner, names?: string[]): Promise<string[]> {
  const defs = cfg().services.filter((s) => !names || names.includes(s.name))
  const out: string[] = []
  await Promise.all(defs.filter((s) => s.kind === 'process' && procs.get(s.name) && !procs.get(s.name)!.exited).map(async (s) => { out.push(await stopService(s.name, caller)) }))
  if (caller.kind === 'user' && await dockerOk(true)) {
    for (const [repo, ds] of dockerGroups(defs)) {
      try { await run('docker', ['compose', 'stop', ...ds.map((s) => s.compose)], { cwd: repoDir(repo), timeout: 180_000 }); ds.forEach((s) => dockerCache.set(s.name, 'exited')); out.push(`docker (${repo}): stopped`) } catch (e) { out.push(`docker (${repo}): ${(e as Error).message}`) }
    }
  }
  publish()
  return out
}

export async function logs(name: string, last?: number): Promise<string> {
  const s = svcByName(name)
  if (s.kind === 'process') return procs.get(name)?.log.text(last) ?? `(no logs: ${appName()} has not started this service)`
  try {
    const out = await run('docker', ['compose', 'logs', '--no-color', '--tail', String(last ?? 300), s.compose], { cwd: repoDir(s.repo), timeout: 30_000 })
    return (dockerLogs.get(name)?.text() ?? '') + (out ? `\n${out}` : '')
  } catch (e) {
    return `${dockerLogs.get(name)?.text() ?? ''}\n${(e as Error).message}`.trim()
  }
}

// ---------- agent side ----------

export function setThreadTitle(id: string, title: string) { if (title) titles.set(id, title) }
// a closed thread's services keep running; from then on they belong to the user
export function releaseThread(id: string) {
  for (const p of procs.values()) if (p.owner.kind === 'thread' && p.owner.id === id) p.owner = USER
  titles.delete(id)
  publish()
}

async function settle(names: string[], ms: number) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    await refreshPorts()
    if (!snapshot().services.some((s) => names.includes(s.name) && s.state === 'starting')) return
    await sleep(1000)
  }
}

export async function agentStack(stackId: string, branches: Record<string, string> | undefined, action: 'start' | 'stop' | 'status', caller: Owner): Promise<string> {
  if (!loaded.config) return loaded.message
  const stack = cfg().stacks.find((s) => s.id === stackId)
  if (!stack) return `Unknown stack "${stackId}". Known stacks: ${cfg().stacks.map((s) => s.id).join(', ') || 'none configured'}`
  const defs = stack.services.map(svcByName)
  const names = defs.map((s) => s.name)
  const report = (head: string[]) => [...head, '', formatStatus(snapshot().services.filter((s) => names.includes(s.name)), docker), ...failedLogs(names)].join('\n')
  if (action === 'status') { await status(); return report([]) }
  if (action === 'stop') return report([...(await stopAll(caller, names.filter((n) => svcByName(n).kind === 'process'))), 'Docker databases are shared and are left running.'])
  const repos = new Set(defs.filter((s) => s.kind === 'process').map((s) => s.repo))
  const bad = Object.keys(branches ?? {}).filter((r) => !repos.has(r))
  if (bad.length) return `Not in stack ${stackId}: ${bad.join(', ')}. Repos you can set a branch for: ${[...repos].join(', ')}`
  const srcs: Record<string, Source> = {}
  for (const [repo, b] of Object.entries(branches ?? {})) srcs[repo] = { kind: 'branch', branch: b }
  const lines = await startStack(stackId, srcs, caller)
  await settle(names, 90_000)
  return report(lines)
}

// last log lines of any service that failed, so the agent sees the startup error
const failedLogs = (names: string[]) =>
  snapshot().services.filter((s) => names.includes(s.name) && s.state === 'failed' && s.kind === 'process')
    .map((s) => `\n--- ${s.name} log (last 25 lines) ---\n${procs.get(s.name)?.log.text(25) ?? ''}`)

// ---------- thread worktrees (the worktree tool) ----------

// a worktree for one repo on a branch (or a ticket's branch), made under the worktree root from origin's default branch
// unless `base` says otherwise; reused when that branch already has one
export async function ensureWorktree(repo: string, want: { branch?: string; ticket?: string }, base?: string): Promise<{ path: string; branch: string; note: string }> {
  if (!validRepoName(repo)) throw new Error(`"${repo}" is not a repo folder name under the repos root`)
  const main = repoDir(repo)
  if (!existsSync(join(main, '.git'))) throw new Error(`${repo} is not a git repo at ${main}`)
  const wts = await worktrees(repo)
  const local = await refNames(main, 'refs/heads')
  const plan = planWorktree({ ...want, mainDir: main, worktrees: wts, localBranches: local })
  if (!plan.ok) throw new Error(plan.error)
  if (plan.act === 'reuse') return { path: plan.path, branch: plan.branch, note: 'existing worktree reused' }
  if (!plan.create) return { path: await addWorktree(repo, plan.branch), branch: plan.branch, note: `new worktree for the existing local branch` }
  let from = base?.trim()
  if (!from) {
    const sym = await git(main, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']).catch(() => null)
    const remote = (await refNames(main, 'refs/remotes/origin')).map((s) => s.replace(/^origin\//, ''))
    const def = detectDefault(sym, remote)
    if (!def) throw new Error(`${repo}: could not tell origin's default branch; pass base`)
    from = `origin/${def}`
  }
  // fresh base: fetch the remote branch first (a failed fetch falls back to the last fetched copy, and says so)
  let fetchNote = ''
  const rm = from.match(/^origin\/(.+)$/)
  if (rm) await git(main, ['fetch', 'origin', rm[1]]).catch((e) => { fetchNote = ` (fetch failed, used the last fetched ${from}: ${(e as Error).message})` })
  return { path: await addWorktree(repo, plan.branch, from), branch: plan.branch, note: `new branch from ${from}${fetchNote}` }
}

// Hive services still running from a folder
const runningFrom = (dir: string) => [...procs.entries()].filter(([, p]) => !p.exited && samePath(p.dir, dir)).map(([n]) => n)

// a closed / archived thread's worktree: refuse while a service runs from it, auto-save uncommitted work as a WIP commit
// on its branch, then delete the folder. Never deletes the branch, never pushes. done = the link can be forgotten.
export async function retireWorktree(l: WorktreeLink): Promise<{ done: boolean; note: string }> {
  const head = `${l.repo} ${l.branch}`
  try {
    const main = repoDir(l.repo)
    const exists = existsSync(l.path)
    const registered = exists && (await worktrees(l.repo)).some((w) => samePath(w.path, l.path))
    const status = registered ? await git(l.path, ['status', '--porcelain']) : ''
    const d = decideCleanup({ exists, isMain: samePath(l.path, main), registered, dirty: hasWork(status), running: runningFrom(l.path) })
    if (d.act === 'refuse') return { done: false, note: `${head}: ${d.note}` }
    if (d.act === 'gone') {
      await git(main, ['worktree', 'prune']).catch(() => {})
      return { done: true, note: `${head}: worktree ${d.note}` }
    }
    // the node_modules link points at the main checkout's folder: remove the link itself first, so it is never
    // committed and git never deletes through it (prepareWorktree puts it back if the folder is ever reused)
    const nm = join(l.path, 'node_modules')
    try { if (lstatSync(nm).isSymbolicLink()) unlinkSync(nm) } catch { /* none */ }
    if (d.commit) {
      try {
        await git(l.path, ['add', '-A'])
        const copies = envCopies(status)
        if (copies.length) await git(l.path, ['reset', '-q', '--', ...copies])
        await git(l.path, ['commit', '-m', WIP_MESSAGE])
      } catch (e) {
        await git(l.path, ['reset', '-q']).catch(() => {})
        prepareWorktree(main, l.path)
        return { done: false, note: `${head}: could not auto-save the uncommitted changes (${(e as Error).message}); worktree kept` }
      }
    }
    await git(main, ['worktree', 'remove', '--force', l.path])
    publish()
    return { done: true, note: `${head}: ${d.commit ? `uncommitted changes saved as "${WIP_MESSAGE}"; ` : ''}worktree deleted, branch kept` }
  } catch (e) {
    return { done: false, note: `${head}: could not delete the worktree (${(e as Error).message}); kept` }
  }
}
