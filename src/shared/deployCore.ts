// Deploy section: pure logic (git log parsing, ahead counts, changelog message, landed / stuck decisions).
// No imports and no I/O, so it can be tested without Electron.

export type Suite = string // a suite id from the Hive .env
export type Target = 'staging' | 'prod'
export type Env = 'dev' | 'qa' | 'staging' | 'prod'
export type Commit = { sha: string; title: string; author: string; pr?: number }
export const ENVS: Env[] = ['dev', 'qa', 'staging', 'prod']

// ---------- config (from Hive's .env; nothing workspace-specific lives in this file) ----------

export type DeploySuite = { id: string; label: string; api: string[]; web: string[] } // API repos deploy before web repos
export type DeployWeb = { host: string; distribution: string } // S3 bucket (also the site host) + CloudFront distribution
export type DeployConfig = {
  org: string // GitHub org for compare links
  region: string // AWS region for the read-only checks
  script: string // deploy script, absolute or relative to the repos root
  diffsScript: string // diffs script (default: diffs.sh next to the deploy script), absolute or relative to the repos root
  suites: DeploySuite[]
  apiRepo: string // the repo with an ECS landed check ('' = none)
  cluster: string // ECS cluster, {env} = dev / qa / staging / prod
  services: string[] // ECS service keys; the first one's image is what "served" means
  serviceName: string // full ECS service name, {cluster} and {service}
  webRepo: string // the repo with an S3 + CloudFront landed check ('' = none)
  web: Partial<Record<Env, DeployWeb>>
  // your own landed watcher, run after the push instead of the built-in check: {env} {kind} (api / web) {sha} are
  // filled in; it prints progress lines and ends with DEPLOY DONE (exit 0) or DEPLOY FAILED
  watchCmd: string
}

const items = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const envKey = (k: string) => k.toUpperCase().replace(/[^A-Z0-9]/g, '_')

export function parseDeployConfig(env: Record<string, string>): { config: DeployConfig | null; problems: string[] } {
  const problems: string[] = []
  const ids = items(env.HIVE_DEPLOY_SUITES)
  if (!ids.length) return { config: null, problems: ['HIVE_DEPLOY_SUITES is not set'] }
  const g = (k: string) => (env[k] ?? '').trim()
  const suites: DeploySuite[] = ids.map((id) => {
    const p = `HIVE_DEPLOY_SUITE_${envKey(id)}_`
    const s = { id, label: g(p + 'LABEL') || id, api: items(env[p + 'API']), web: items(env[p + 'WEB']) }
    if (!s.api.length && !s.web.length) problems.push(`suite ${id}: ${p}API / ${p}WEB are empty`)
    return s
  })
  const web: DeployConfig['web'] = {}
  for (const e of ENVS) {
    const [host, distribution] = items(env[`HIVE_DEPLOY_WEB_${envKey(e)}`])
    if (host && distribution) web[e] = { host, distribution }
  }
  const script = g('HIVE_DEPLOY_SCRIPT')
  if (!script) problems.push('HIVE_DEPLOY_SCRIPT is not set')
  return {
    config: {
      org: g('HIVE_DEPLOY_ORG'), region: g('HIVE_DEPLOY_REGION') || 'us-east-1', script, suites,
      diffsScript: g('HIVE_DIFFS_SCRIPT') || (script ? script.replace(/[^/\\]*$/, 'diffs.sh') : ''),
      apiRepo: g('HIVE_DEPLOY_API_REPO'), cluster: g('HIVE_DEPLOY_API_CLUSTER'), services: items(env.HIVE_DEPLOY_API_SERVICES),
      serviceName: g('HIVE_DEPLOY_API_SERVICE_NAME') || '{cluster}-{service}',
      webRepo: g('HIVE_DEPLOY_WEB_REPO'), web, watchCmd: g('HIVE_DEPLOY_WATCH_CMD'),
    },
    problems,
  }
}

export const suiteOf = (c: DeployConfig, id: Suite) => c.suites.find((s) => s.id === id)
// API repos before web repos (the order diffs and deploys run in)
export const suiteRepos = (c: DeployConfig, id: Suite) => { const s = suiteOf(c, id); return s ? [...s.api, ...s.web] : [] }
export const allRepos = (c: DeployConfig) => [...new Set(c.suites.flatMap((s) => [...s.api, ...s.web]))]
export const clusterFor = (c: DeployConfig, env: Env) => c.cluster.split('{env}').join(env)
export const serviceFull = (c: DeployConfig, cluster: string, svc: string) => c.serviceName.split('{cluster}').join(cluster).split('{service}').join(svc)
// "dev-x-api-service" -> "api" (the configured key), else the full name
export const serviceShort = (c: DeployConfig, cluster: string, full: string) => c.services.find((s) => serviceFull(c, cluster, s) === full) ?? full

// `git log --format=...` line shape used by main: short sha, author, title separated by the unit separator
export const LOG_FORMAT = '%h%x1f%an%x1f%s'

export const prNumber = (title: string): number | undefined => {
  const m = title.match(/\(#(\d+)\)\s*$/) ?? title.match(/\(#(\d+)\)/)
  return m ? Number(m[1]) : undefined
}

export function parseLog(out: string): Commit[] {
  const commits: Commit[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [sha, author, ...rest] = line.replace(/\r$/, '').split('\x1f')
    if (!sha || rest.length === 0) continue
    const title = rest.join('\x1f')
    const pr = prNumber(title)
    commits.push({ sha, author, title, ...(pr ? { pr } : {}) })
  }
  return commits
}

export type RepoDiff = {
  repo: string
  error?: string
  mainSha?: string
  stagingSha?: string
  prodSha?: string
  toStaging: Commit[] // on origin/main, not on origin/staging
  toProd: Commit[] // on origin/staging, not on origin/prod
  migrations: boolean // main vs prod touches migrations/
}

// ---------- diffs.sh output ----------

// One repo as the diffs script reported it. diffs.sh is the source of truth for what changed;
// Hive only reads git afterwards for commit titles (see deploy.ts).
export type DiffsLine = {
  repo: string
  error?: string // "repo not found at ...", "git fetch timed out or failed", "failed to get origin/main", ...
  changes: boolean // false = "No changes to deploy"
  url?: string // compare URL prod...main
  prodSha?: string
  mainSha?: string
  migrations: boolean // "⚠️ CONTAINS MIGRATIONS"
  stagingAhead?: { count: number; url: string; prodSha: string; stagingSha: string } // "⚠️ STAGING AHEAD OF PROD: N commit(s) ..."
}
export type DiffsReport = { message: string; repos: DiffsLine[] }

const COMPARE = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/compare\/([0-9a-f]{7,40})\.\.\.([0-9a-f]{7,40})/

// diffs.sh stdout -> the message it copies (everything above the "-----" footer) and one entry per repo line
export function parseDiffsOutput(out: string): DiffsReport {
  const text = out.replace(/\r\n/g, '\n')
  const cut = text.indexOf('\n-----\n')
  const message = (cut >= 0 ? text.slice(0, cut) : text).replace(/\n+$/, '')
  const repos: DiffsLine[] = []
  let inLog = false
  for (const line of message.split('\n')) {
    if (line === 'Changelogs:') { inLog = true; continue }
    if (!inLog || !line.trim()) continue
    const ahead = line.match(/^\s+⚠️ STAGING AHEAD OF PROD: (\d+) commit/)
    if (ahead) {
      const last = repos[repos.length - 1]
      const m = line.match(COMPARE)
      if (last && m) last.stagingAhead = { count: Number(ahead[1]), url: m[0], prodSha: m[1], stagingSha: m[2] }
      continue
    }
    const m = line.match(/^(\S+): (.*)$/)
    if (!m) continue
    const [, repo, rest] = m
    if (rest === 'No changes to deploy') { repos.push({ repo, changes: false, migrations: false }); continue }
    const c = rest.match(COMPARE)
    if (c) { repos.push({ repo, changes: true, url: c[0], prodSha: c[1], mainSha: c[2], migrations: rest.includes('CONTAINS MIGRATIONS') }); continue }
    repos.push({ repo, error: rest, changes: false, migrations: false })
  }
  return { message, repos }
}

// staging deployed but never promoted: those commits ship with the next prod deploy
export const stagingAheadOfProd = (d: RepoDiff) => d.toProd.length

// a deploy button has nothing to do when its list is empty (or the repo errored)
export const commitsFor = (d: RepoDiff, t: Target) => (d.error ? [] : t === 'staging' ? d.toStaging : d.toProd)

// diffs.sh's message rebuilt from local refs, only for the instant first view before diffs.sh itself is back
export function changelog(suite: Suite, diffs: RepoDiff[], org: string): string {
  const lines = [
    `I'm going to do a deploy shortly for the ${suite} suite, let me know if there are any concerns. *It is likely prudent to pause any merges to main.*`,
    'Changelogs:',
  ]
  for (const d of diffs) {
    if (d.error) { lines.push(`${d.repo}: ${d.error}`); continue }
    let url: string
    if (d.mainSha === d.prodSha) url = 'No changes to deploy'
    else {
      url = `https://github.com/${org}/${d.repo}/compare/${d.prodSha}...${d.mainSha}`
      if (d.migrations) url += ' ⚠️ CONTAINS MIGRATIONS'
    }
    lines.push(`${d.repo}: ${url}`)
    if (d.stagingSha && d.toProd.length > 0) {
      lines.push(`  ⚠️ STAGING AHEAD OF PROD: ${d.toProd.length} commit(s) deployed to staging but never to prod - they ship with this deploy: https://github.com/${org}/${d.repo}/compare/${d.prodSha}...${d.stagingSha}`)
    }
  }
  return lines.join('\n')
}

// ---------- landed check ----------

// branch -> env: main is dev + qa, staging is staging, prod is prod
export const branchOf = (env: Env) => (env === 'dev' || env === 'qa' ? 'main' : env)

// only the configured API and web repos have a read-only landed check
export const watchKind = (repo: string, c: Pick<DeployConfig, 'apiRepo' | 'webRepo'>): 'api' | 'web' | null =>
  (c.apiRepo && repo === c.apiRepo ? 'api' : c.webRepo && repo === c.webRepo ? 'web' : null)

export const HOLD_POLLS = 4 // api: running == desired must hold this many polls with the same task ids
export const POLL_MS = 30_000
export const TIMEOUT_MS = 20 * 60_000

// the tag of "registry:5000/repo:<tag>"; '' for an image with no tag or one pinned by digest ("repo@sha256:..."),
// whose digest is not a commit and must never be compared with one
export const imageSha = (image: string) => {
  if (image.includes('@')) return ''
  const name = image.slice(image.lastIndexOf('/') + 1)
  const at = name.lastIndexOf(':')
  return at < 0 ? '' : name.slice(at + 1)
}
export const sameSha = (a?: string | null, b?: string | null) => !!a && !!b && a.length >= 7 && b.length >= 7 && (a.startsWith(b) || b.startsWith(a))

export type ApiService = { name: string; image: string; rollout: string; deployments: number; desired: number; running: number; tasks: string }
export type ApiObs = { services: ApiService[] }
export type WebObs = { s3?: string; live?: string; invalidation?: string } // invalidation = "<time>\t<Status>"
export type Verdict = { state: 'waiting' | 'landed' | 'failed'; note: string }
export type Hold = { ok: number; tasks: string }

// one api poll: returns the verdict and the next hold state (restart of tasks resets the hold, like watch.sh)
export function stepApi(sha: string, obs: ApiObs, hold: Hold): { verdict: Verdict; hold: Hold } {
  const sv = obs.services
  const run = sv.reduce((n, s) => n + s.running, 0)
  const des = sv.reduce((n, s) => n + s.desired, 0)
  const failed = sv.find((s) => s.rollout === 'FAILED')
  if (failed) return { verdict: { state: 'failed', note: `ECS rollout FAILED for ${failed.name}` }, hold: { ok: 0, tasks: '' } }
  if (sv.length === 0) return { verdict: { state: 'waiting', note: 'no service data yet' }, hold: { ok: 0, tasks: '' } }
  // an image with no commit tag can never be matched: say so now instead of waiting out the timeout
  const untagged = sv.find((s) => s.image && !imageSha(s.image))
  if (untagged) return { verdict: { state: 'failed', note: `${untagged.name} runs ${untagged.image}, which has no commit tag: cannot tell what is serving` }, hold: { ok: 0, tasks: '' } }
  const healthy = sv.every((s) => sameSha(imageSha(s.image), sha) && s.rollout === 'COMPLETED' && s.deployments === 1 && s.running === s.desired && s.desired > 0)
  if (!healthy) {
    const old = sv.filter((s) => !sameSha(imageSha(s.image), sha)).length
    const why = old ? 'rolling out' : 'settling'
    return { verdict: { state: 'waiting', note: `${why} (${run}/${des} tasks)` }, hold: { ok: 0, tasks: '' } }
  }
  const tasks = sv.map((s) => s.tasks).join('|')
  const ok = hold.ok > 0 && tasks !== hold.tasks ? 1 : hold.ok + 1 // a changed task set resets the hold
  if (ok >= HOLD_POLLS) return { verdict: { state: 'landed', note: `landed on ${sha.slice(0, 7)}` }, hold: { ok, tasks } }
  return { verdict: { state: 'waiting', note: `healthy ${ok}/${HOLD_POLLS} (${run}/${des} tasks)` }, hold: { ok, tasks } }
}

export function stepWeb(sha: string, obs: WebObs): Verdict {
  const done = sameSha(obs.s3, sha) && sameSha(obs.live, sha) && /Completed/.test(obs.invalidation ?? '')
  if (done) return { state: 'landed', note: `landed on ${sha.slice(0, 7)}` }
  const bits = [`s3 ${obs.s3?.slice(0, 7) ?? '?'}`, `live ${obs.live?.slice(0, 7) ?? '?'}`]
  if (sameSha(obs.s3, sha) && sameSha(obs.live, sha)) bits.push('invalidation pending')
  return { state: 'waiting', note: `rolling out (${bits.join(', ')})` }
}

// the decision after a poll: landed / failed end the watch, a waiting verdict past the timeout becomes stuck
export type Outcome = { done: boolean; ok: boolean; note: string }
export function decide(v: Verdict, elapsedMs: number, timeoutMs = TIMEOUT_MS): Outcome {
  if (v.state === 'landed') return { done: true, ok: true, note: v.note }
  if (v.state === 'failed') return { done: true, ok: false, note: `stuck: ${v.note}` }
  if (elapsedMs >= timeoutMs) return { done: true, ok: false, note: `stuck: not serving after ${Math.round(elapsedMs / 60_000)} min (${v.note})` }
  return { done: false, ok: false, note: v.note }
}

// ---------- check status ----------

export type StatusCell = { served?: string; head: string; behind: number | null; verdict: 'current' | 'behind' | 'unknown'; note?: string }

export function cell(served: string | undefined, head: string, behind: number | null, note?: string): StatusCell {
  if (!served) return { head, behind: null, verdict: 'unknown', note: note ?? 'unreadable' }
  if (sameSha(served, head)) return { served, head, behind: 0, verdict: 'current' }
  return { served, head, behind, verdict: behind === null ? 'unknown' : behind > 0 ? 'behind' : 'current', ...(note ? { note } : {}) }
}

// the sha a web bundle was built from: Datadog RUM string  version:`<sha>`
export const webVersion = (js: string) => js.match(/version:`([0-9a-f]{7,})`/)?.[1]
export const bundlePath = (html: string) => html.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0]

// ---------- Diagnose prompt ----------
export const diagnosePrompt = (repo: string, target: Target, note: string) =>
  `The ${target} deploy of ${repo} does not seem to have landed (${note}). Find out why, read-only: compare the ${branchOf(target)} head with what ${target} is serving, check the ECS services / S3 + CloudFront, the service events, any stopped task reasons and logs. Do not change anything. Report the root cause with evidence.`

// ---------- your own watch command ----------

export const watchCommand = (tpl: string, env: string, kind: string, sha: string): string =>
  tpl.replaceAll('{env}', env).replaceAll('{kind}', kind).replaceAll('{sha}', sha)

// how the watch command ended: landed only on exit 0 with a DEPLOY DONE line; otherwise its DEPLOY FAILED line, else
// its last line, is why
export function watchEnd(code: number | null, lines: string[]): Verdict {
  const done = lines.find((l) => /^DEPLOY DONE/.test(l))
  if (code === 0 && done) return { state: 'landed', note: done }
  const why = lines.find((l) => /^DEPLOY FAILED/.test(l)) ?? lines.filter((l) => l.trim()).at(-1)
  return { state: 'failed', note: why ?? `the watch command exited with ${code}` }
}
