// Deploy section, main process. Diffs come from your deploy tooling's diffs.sh (it does the fetch); Hive's own git calls
// are read-only (log / rev-parse / diff --name-only; Check status also fetches).
// The only write is running your deploy.sh (HIVE_DEPLOY_SCRIPT), and only from the user's click (IPC, never a Claude tool).
// AWS calls are read-only (describe / list / s3 cp to stdout).
import { BrowserWindow, type WebContents } from 'electron'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import {
  ENVS, LOG_FORMAT, POLL_MS, TIMEOUT_MS, allRepos, branchOf, bundlePath, cell, changelog, clusterFor, decide, imageSha, parseDeployConfig, parseDiffsOutput, parseLog, serviceFull,
  serviceShort, stepApi, stepWeb, suiteRepos, watchKind, webVersion,
  type ApiObs, type DeployConfig, type DiffsLine, type Env, type Hold, type RepoDiff, type StatusCell, type Suite, type Target, type WebObs,
} from '../shared/deployCore'
import type { Loaded } from './devConfig'
import { blocked, TEST_MODE } from './testMode'

// everything workspace-specific (repos, suites, org, AWS names, the deploy script) comes from Hive's .env
let root = ''
let dcfg: DeployConfig | null = null
const NOT_SET = 'Deploy is not configured: fill in the Deploy section of Settings.'
let dmsg = NOT_SET
// called again when the settings change
export function initDeploy(l: Loaded) {
  dcfg = null
  dmsg = NOT_SET
  root = l.config?.root ?? ''
  if (!root) { dmsg = l.message; return }
  const p = parseDeployConfig(l.env)
  dcfg = p.config
  if (p.problems.length) dmsg = `Deploy config: ${p.problems.join('; ')}`
  if (dcfg && !dcfg.script) dcfg = null
}
const dc = (): DeployConfig => {
  if (!dcfg) throw new Error(dmsg)
  return dcfg
}
// the renderer's copy: suite labels and repo lists (no secrets live in the deploy config)
export const deployConfig = () => (dcfg ? { config: dcfg, message: '' } : { config: null, message: dmsg })

const repoDir = (repo: string) => {
  if (!allRepos(dc()).includes(repo)) throw new Error(`Unknown repo ${repo}`)
  const d = join(root, repo)
  if (!existsSync(d)) throw new Error(`${repo} not found at ${d}`)
  return d
}
const scriptPath = (p: string) => (isAbsolute(p) ? p : resolve(root, p))
const deployScript = () => scriptPath(dc().script)
// On Windows a bare `bash` resolves to System32\bash.exe (WSL), not Git Bash, so run the scripts with Git Bash like a terminal does
// (git --exec-path is <git root>\mingw64\libexec\git-core, so Git installed anywhere on PATH is found too)
let bashPath = ''
function findBash(): string {
  if (process.platform !== 'win32') return 'bash'
  const roots = [join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git')]
  try { roots.push(resolve(execFileSync('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true }).trim(), '..', '..', '..')) } catch { /* git not on PATH */ }
  return roots.map((r) => join(r, 'bin', 'bash.exe')).find((p) => existsSync(p)) ?? 'bash'
}
const BASH = () => (bashPath ||= findBash())

const run = (cmd: string, args: string[], opts: { cwd?: string; timeout?: number } = {}) =>
  new Promise<string>((ok, bad) => {
    execFile(cmd, args, { cwd: opts.cwd, timeout: opts.timeout ?? 60_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', AWS_REGION: dcfg?.region ?? '' } },
      (err, stdout, stderr) => (err ? bad(new Error((stderr || err.message).toString().trim())) : ok(stdout.toString())))
  })
const git = (repo: string, args: string[], timeout?: number) => run('git', args, { cwd: repoDir(repo), timeout })
const sha = async (repo: string, ref: string) => (await git(repo, ['rev-parse', ref])).trim()

// ---------- suite diffs ----------

const log = async (repo: string, range: string) => parseLog(await git(repo, ['log', `--format=${LOG_FORMAT}`, range]))

// The instant first view: the refs already on disk, no fetch. diffs.sh replaces it once it is back.
async function localDiff(repo: string): Promise<RepoDiff> {
  try {
    const mainSha = await sha(repo, 'origin/main')
    const prodSha = await sha(repo, 'origin/prod')
    const stagingSha = await sha(repo, 'origin/staging').catch(() => undefined)
    const toStaging = await log(repo, `${stagingSha ? 'origin/staging' : 'origin/prod'}..origin/main`)
    const toProd = stagingSha ? await log(repo, 'origin/prod..origin/staging') : []
    const migrations = mainSha !== prodSha && (await git(repo, ['diff', '--name-only', `${prodSha}..${mainSha}`])).split('\n').some((f) => f.includes('migrations/'))
    return { repo, mainSha, stagingSha, prodSha, toStaging, toProd, migrations }
  } catch (e) {
    return { repo, toStaging: [], toProd: [], migrations: false, error: (e as Error).message.split('\n')[0] }
  }
}

// The diffs script (HIVE_DIFFS_SCRIPT), run exactly as by hand (`bash diffs.sh <suite>` from its own folder). It fetches with
// its own timeout and, like by hand, copies its message to the clipboard.
function runDiffsScript(suite: Suite): Promise<string> {
  const script = scriptPath(dc().diffsScript)
  if (!existsSync(script)) throw new Error(`diffs.sh not found at ${script} (set HIVE_DIFFS_SCRIPT)`)
  return new Promise((ok, bad) => {
    const child = spawn(BASH(), [basename(script), suite], { cwd: dirname(script), windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill(), 180_000)
    child.stdout.on('data', (b) => (out += b.toString()))
    child.stderr.on('data', (b) => (err += b.toString()))
    child.on('error', (e) => { clearTimeout(timer); bad(new Error(`Could not start bash: ${e.message}`)) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) bad(new Error(`diffs.sh ${suite} exited ${code ?? 'killed'}: ${(err || out).trim().split('\n').slice(0, 3).join(' ')}`))
      else ok(out)
    })
  })
}

// diffs.sh is the source of truth for what changed and which repos have something to ship. Its output has no
// commit titles, so they are read with git log from the same refs right after diffs.sh fetched them (no second fetch).
async function diffFromLine(repo: string, l: DiffsLine | undefined): Promise<RepoDiff> {
  const base: RepoDiff = { repo, toStaging: [], toProd: [], migrations: !!l?.migrations }
  if (!l) return { ...base, error: 'not in diffs.sh output' }
  if (l.error) return { ...base, error: l.error }
  try {
    const stagingSha = await sha(repo, 'origin/staging').catch(() => undefined)
    const prodSha = l.prodSha ?? l.stagingAhead?.prodSha
    // main -> staging: only when diffs.sh reported main ahead of prod
    const toStaging = l.changes && l.mainSha ? await log(repo, `${stagingSha ?? l.prodSha}..${l.mainSha}`) : []
    // staging -> prod: only when diffs.sh reported staging ahead of prod
    const toProd = l.stagingAhead && prodSha ? await log(repo, `${prodSha}..${l.stagingAhead.stagingSha}`) : []
    return { ...base, mainSha: l.mainSha, prodSha, stagingSha, toStaging, toProd }
  } catch (e) {
    return { ...base, error: `diffs.sh ok, but reading commit titles failed: ${(e as Error).message.split('\n')[0]}` }
  }
}

// fetch=false: the instant local view; fetch=true: run diffs.sh (output shown verbatim, steps planned from it)
export async function suiteDiffs(suite: Suite, fetch = true) {
  const repos = suiteRepos(dc(), suite)
  if (!repos.length) throw new Error('Unknown suite')
  if (!fetch) {
    const diffs = await Promise.all(repos.map(localDiff))
    return { diffs, changelog: changelog(suite, diffs, dc().org), output: '', root }
  }
  const output = await runDiffsScript(suite)
  const report = parseDiffsOutput(output)
  const diffs = await Promise.all(repos.map((r) => diffFromLine(r, report.repos.find((x) => x.repo === r))))
  return { diffs, changelog: report.message, output, root }
}

// ---------- deploy (user click only) ----------

const running = new Set<string>()

// Called only by the wizard's Yes click (IPC); one repo, one target, nothing to deploy is refused.
export async function startDeploy(sender: WebContents, repo: string, target: Target): Promise<{ runId: string }> {
  if (target !== 'staging' && target !== 'prod') throw new Error('Target must be staging or prod')
  const cwd = repoDir(repo)
  if (TEST_MODE) {
    const runId = `${repo}-${target}-${Date.now()}`
    setTimeout(() => {
      if (sender.isDestroyed()) return
      sender.send('deploy:out', runId, `$ bash deploy.sh ${target}   (in ${repo})\n${blocked('deploy.sh')}: stub output, nothing was pushed\n`)
      sender.send('deploy:end', runId, -1, blocked('deploy.sh'), '', '')
    }, 50)
    return { runId }
  }
  if (running.has(repo)) throw new Error(`A deploy of ${repo} is already running`)
  // refs as diffs.sh last fetched them (or the previous push updated them); deploy.sh fetches again itself
  const d = await localDiff(repo)
  if (d.error) throw new Error(d.error)
  if ((target === 'staging' ? d.toStaging : d.toProd).length === 0) throw new Error(`Nothing to deploy to ${target}`)

  const runId = `${repo}-${target}-${Date.now()}`
  running.add(repo)
  const send = (ch: string, ...a: unknown[]) => { if (!sender.isDestroyed()) sender.send(ch, runId, ...a) }
  send('deploy:out', `$ bash deploy.sh ${target}   (in ${repo})\n`)
  const child = spawn(BASH(), [deployScript(), target], { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  child.stdout.on('data', (b) => send('deploy:out', b.toString()))
  child.stderr.on('data', (b) => send('deploy:out', b.toString()))
  child.on('error', (e) => { running.delete(repo); send('deploy:end', -1, `Could not start bash: ${e.message}`, '', '') })
  child.on('close', async (code) => {
    running.delete(repo)
    // deploy.sh args: (code, message, pushed sha, watcher id)
    if (code !== 0) return send('deploy:end', code ?? -1, 'Deploy script failed; nothing is being watched.', '', '')
    try {
      const pushed = await sha(repo, `origin/${target}`)
      if (!watchKind(repo, dc())) return send('deploy:end', 0, 'Pushed; landed check not available yet for this repo.', pushed, '')
      send('deploy:end', 0, `Pushed ${pushed.slice(0, 7)}; watching until it is serving.`, pushed, startWatch(repo, target, pushed))
    } catch (e) {
      send('deploy:end', 0, `Pushed; could not read or watch the pushed sha: ${(e as Error).message}`, '', '')
    }
  })
  return { runId }
}

// ---------- read-only AWS ----------

const awsJson = async (args: string[]) => JSON.parse(await run('aws', [...args, '--region', dc().region, '--output', 'json'], { timeout: 45_000 }))
const tdImage = new Map<string, string>()

async function apiObs(env: Env, withTasks: boolean): Promise<ApiObs> {
  const c = dc()
  const cluster = clusterFor(c, env)
  const names = c.services.map((s) => serviceFull(c, cluster, s))
  const r = await awsJson(['ecs', 'describe-services', '--cluster', cluster, '--services', ...names])
  const services: ApiObs['services'] = []
  for (const s of r.services ?? []) {
    const dep = s.deployments?.[0]
    if (!dep) continue
    const td: string = dep.taskDefinition
    if (!tdImage.has(td)) {
      const t = await awsJson(['ecs', 'describe-task-definition', '--task-definition', td])
      tdImage.set(td, t.taskDefinition.containerDefinitions[0].image)
    }
    let tasks = ''
    if (withTasks) {
      const l = await awsJson(['ecs', 'list-tasks', '--cluster', cluster, '--service-name', s.serviceName, '--desired-status', 'RUNNING'])
      tasks = (l.taskArns as string[]).map((a) => a.split('/').pop()).sort().join(',')
    }
    services.push({ name: serviceShort(c, cluster, String(s.serviceName)), image: tdImage.get(td)!, rollout: dep.rolloutState, deployments: s.deployments.length, desired: s.desiredCount, running: s.runningCount, tasks })
  }
  return { services }
}

async function webObs(env: Env): Promise<WebObs> {
  const w = dc().web[env]
  if (!w) throw new Error(`HIVE_DEPLOY_WEB_${env.toUpperCase()} is not set`)
  const [bucket, dist, region] = [w.host, w.distribution, dc().region]
  const obs: WebObs = {}
  try {
    const html = await run('aws', ['s3', 'cp', `s3://${bucket}/index.html`, '-', '--region', region])
    const js = bundlePath(html)
    if (js) obs.s3 = webVersion(await run('aws', ['s3', 'cp', `s3://${bucket}/${js}`, '-', '--region', region]))
  } catch { /* unreadable */ }
  try {
    const html = await (await fetch(`https://${bucket}/`)).text()
    const js = bundlePath(html)
    if (js) obs.live = webVersion(await (await fetch(`https://${bucket}/${js}`)).text())
  } catch { /* unreadable */ }
  try {
    const r = await awsJson(['cloudfront', 'list-invalidations', '--distribution-id', dist])
    const i = r.InvalidationList?.Items?.[0]
    if (i) obs.invalidation = `${i.CreateTime}\t${i.Status}`
  } catch { /* unreadable */ }
  return obs
}

// ---------- check status (on demand) ----------

export type EnvStatus = { env: Env; api: StatusCell & { detail: string }; web: StatusCell & { detail: string } }

async function head(repo: string, env: Env) {
  const h = await sha(repo, `origin/${branchOf(env)}`)
  return h
}
const behind = (repo: string, served: string, h: string) =>
  git(repo, ['rev-list', '--count', `${served}..${h}`]).then((s) => Number(s.trim())).catch(() => null)

async function envStatus(env: Env): Promise<EnvStatus> {
  const api = (async () => {
    const api = dc().apiRepo
    const first = dc().services[0]
    const h = await head(api, env)
    try {
      const { services } = await apiObs(env, false)
      const shas = [...new Set(services.map((s) => imageSha(s.image).slice(0, 7)))]
      const served = services.find((s) => s.name === first) ? imageSha(services.find((s) => s.name === first)!.image) : undefined
      const detail = services.map((s) => `${s.name} ${imageSha(s.image).slice(0, 7)} ${s.running}/${s.desired}`).join(', ') + (shas.length > 1 ? ' (services differ)' : '')
      return { ...cell(served, h, served ? await behind(api, served, h) : null), detail }
    } catch (e) {
      return { ...cell(undefined, h, null, (e as Error).message.split('\n')[0]), detail: '' }
    }
  })()
  const web = (async () => {
    const web = dc().webRepo
    const h = await head(web, env)
    const o = await webObs(env)
    const served = o.live ?? o.s3
    const detail = `s3 ${o.s3?.slice(0, 7) ?? '?'}, live ${o.live?.slice(0, 7) ?? '?'}, invalidation ${o.invalidation?.split('\t')[1] ?? '?'}`
    return { ...cell(served, h, served ? await behind(web, served, h) : null), detail }
  })()
  return { env, api: await api, web: await web }
}

export async function checkStatus(): Promise<EnvStatus[]> {
  if (!dc().apiRepo || !dc().webRepo) throw new Error('Check status needs HIVE_DEPLOY_API_REPO and HIVE_DEPLOY_WEB_REPO')
  await Promise.all([dc().apiRepo, dc().webRepo].map((r) => git(r, ['fetch'], 30_000).catch(() => '')))
  return Promise.all(ENVS.map(envStatus))
}

// ---------- landed-check watchers (plain polling, no AI session) ----------

export type Watcher = { id: string; repo: string; target: Target; sha: string; state: 'working' | 'waiting'; note: string; stuck: boolean; landed: boolean; startedAt: number; since: number }
const watchers = new Map<string, Watcher>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

const publish = () => {
  const list = [...watchers.values()]
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('deploy:watch', list)
}
export const listWatchers = () => [...watchers.values()]

export function dismissWatcher(id: string) {
  clearTimeout(timers.get(id))
  timers.delete(id)
  watchers.delete(id)
  publish()
}

// "retry the check" after a stuck: a fresh read-only watcher on the same sha
export function rewatch(repo: string, target: Target, sha: string): string {
  if (!watchKind(repo, dc()) || (target !== 'staging' && target !== 'prod') || !/^[0-9a-f]{7,40}$/.test(sha)) throw new Error('Cannot watch that')
  return startWatch(repo, target, sha)
}

function startWatch(repo: string, target: Target, sha: string): string {
  const kind = watchKind(repo, dc())!
  const id = `${repo}-${target}-${Date.now()}`
  const startedAt = Date.now()
  const w: Watcher = { id, repo, target, sha, state: 'working', note: 'starting', stuck: false, landed: false, startedAt, since: startedAt }
  watchers.set(id, w)
  publish()
  let hold: Hold = { ok: 0, tasks: '' }
  const poll = async () => {
    if (!watchers.has(id)) return
    let verdict
    try {
      if (kind === 'api') {
        const r = stepApi(sha, await apiObs(target, true), hold)
        hold = r.hold
        verdict = r.verdict
      } else verdict = stepWeb(sha, await webObs(target))
    } catch (e) {
      verdict = { state: 'waiting' as const, note: `check failed: ${(e as Error).message.split('\n')[0]}` }
    }
    if (!watchers.has(id)) return
    const out = decide(verdict, Date.now() - startedAt, TIMEOUT_MS)
    const cur = watchers.get(id)!
    if (out.done) watchers.set(id, { ...cur, state: 'waiting', note: out.note, stuck: !out.ok, landed: out.ok, since: Date.now() })
    else watchers.set(id, { ...cur, note: out.note })
    publish()
    if (!out.done) timers.set(id, setTimeout(poll, POLL_MS))
  }
  void poll()
  return id
}
