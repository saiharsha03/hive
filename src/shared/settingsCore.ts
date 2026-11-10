// Hive settings: pure logic for the one settings store (~/.claude/hive-settings.json). It keeps the same KEY=VALUE
// names as the .env (so every feature keeps parsing its own keys) plus the scripts list and a few thread defaults.
// First run seeds it from the .env and scripts.json; afterwards it wins and those files are only fallbacks.
// Keys that look like credentials never enter it: they stay in the .env and the panel only says whether they are set.
// No I/O (the exists check is passed in), so it can be tested without Electron.
import { isAbsolute, join } from 'node:path'
import { parseDependabotConfig, parseTime } from './dependabotCore'
import { parseDeployConfig } from './deployCore'
import { parseDevConfig } from './devCore'
import { parseScriptsConfig } from './scriptsCore'
import { EFFORTS } from './statusCore'

// one list for the Settings default and the thread's own picker (statusCore.ts)
export { EFFORTS }
export type Effort = (typeof EFFORTS)[number]
// '' = the default; ui / theme '' = the built-in look (the Appearance pickers fill them); appName / appTagline = what the app calls itself
// desktopNotify: a Windows toast + taskbar flash when a thread needs you and Hive is not focused; on by default
// chrome: threads start with Claude in Chrome (claude --chrome; needs the Claude extension in Chrome); on by default
// bgModel / bgEffort: watcher runs, Dependabot reviews and /btw; teamModel / teamEffort: teammates and a team's own Lead
// ('' = the same as model / effort, so nothing changes until they are set)
// idleCloseMinutes: an idle thread's Claude process closes after this long (the next message resumes it); 0 = never
// teamMemoryKb: how much of each role memory file (the newest entries) goes into a teammate's brief
// advisorModel: the model of Claude Code's server-side advisor tool for new threads (an alias or a full id; '' = off)
// workflows: Claude Code's Workflows feature for new threads: 'on', 'off', or '' = Claude Code's own default (by plan)
export type General = {
  shell: string; model: string; effort: Effort | ''; ui: string; theme: string; appName: string; appTagline: string; chrome: boolean; desktopNotify: boolean
  bgModel: string; bgEffort: Effort | ''; teamModel: string; teamEffort: Effort | ''; idleCloseMinutes: number; teamMemoryKb: number
  advisorModel: string; workflows: '' | 'on' | 'off'
}
export const DEFAULT_IDLE_CLOSE_MINUTES = 30
export const DEFAULT_TEAM_MEMORY_KB = 6
export const DEFAULT_APP_NAME = 'Hive'
export const DEFAULT_APP_TAGLINE = 'One desk, many agents'
export type Settings = {
  version: 1
  env: Record<string, string> // non-secret .env keys; '' = cleared (does not fall back to the .env)
  scripts: unknown[] | null // the scripts.json array as written (bad entries kept so nothing is lost); null = use the file
  general: General
}
export const emptyGeneral = (): General => ({
  shell: '', model: '', effort: '', ui: '', theme: '', appName: DEFAULT_APP_NAME, appTagline: DEFAULT_APP_TAGLINE, chrome: true, desktopNotify: true,
  bgModel: '', bgEffort: '', teamModel: '', teamEffort: '', idleCloseMinutes: DEFAULT_IDLE_CLOSE_MINUTES, teamMemoryKb: DEFAULT_TEAM_MEMORY_KB,
  advisorModel: '', workflows: '',
})

// what the panel edits and gets back
export type Draft = { env: Record<string, string>; scripts: unknown[] | null; general: General }
export type SettingsView = Draft & {
  file: string; envFile: string; scriptsFile: string
  sections: Record<string, Section>
  secrets: { key: string; set: boolean }[] // credential-looking .env keys: whether set, never the value
  problems: Problem[]
  weekly: { pct: number | null; error: string } | null // the 7-day limit right now, for the live tier line (only when asked)
}

// A key whose value is a credential. Anywhere in the name: TOKEN (not TOKENS: MAX_OUTPUT_TOKENS is a limit), SECRET,
// PASSWORD, API key, ACCESS_KEY, CREDENTIAL, PRIVATE. As the last word only, so a service or suite named "auth" or
// "key" keeps its HIVE_SVC_AUTH_* settings: PASS, PWD, PAT, DSN, AUTH, COOKIE, KEY, KEY_ID, WEBHOOK(_URL), and the
// connection URLs that carry a password (DATABASE_URL, REDIS_URL, ...). A *_FILE / *_PATH / *_DIR names a place.
const SECRET_ANYWHERE = /TOKEN(?!S)|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_KEY|CREDENTIAL|PRIVATE/i
const SECRET_LAST = /(^|_)(PASS|PWD|PAT|DSN|AUTH|COOKIE|KEY|KEY_ID|WEBHOOK|WEBHOOK_URL|(DATABASE|DB|REDIS|MONGO|MONGODB|POSTGRES|MYSQL|AMQP|BROKER)_UR[LI])$/i
export const isSecretKey = (k: string) =>
  (SECRET_ANYWHERE.test(k) || SECRET_LAST.test(k)) && !/_(FILE|PATH|DIR)$/i.test(k)

const nonSecret = (env: Record<string, string>) => Object.fromEntries(Object.entries(env).filter(([k]) => !isSecretKey(k)))

// first run: everything the .env and scripts.json hold today, minus credentials
export function seedSettings(dotEnv: Record<string, string>, scriptsText: string | null): Settings {
  let scripts: unknown[] | null = null
  if (scriptsText !== null) {
    try { const j = JSON.parse(scriptsText); if (Array.isArray(j)) scripts = j } catch { /* unreadable: keep using the file */ }
  }
  return { version: 1, env: nonSecret(dotEnv), scripts, general: emptyGeneral() }
}

// a saved file, made safe: unknown shapes become empty, secrets are dropped
export function normalizeSettings(v: unknown): Settings | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const env: Record<string, string> = {}
  if (o.env && typeof o.env === 'object' && !Array.isArray(o.env))
    for (const [k, x] of Object.entries(o.env as Record<string, unknown>)) if (/^[A-Za-z_]\w*$/.test(k) && typeof x === 'string' && !isSecretKey(k)) env[k] = x
  const g = (o.general && typeof o.general === 'object' ? o.general : {}) as Record<string, unknown>
  const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '')
  const effort = str(g.effort)
  const level = (x: unknown): Effort | '' => ((EFFORTS as readonly string[]).includes(str(x)) ? (str(x) as Effort) : '')
  // a whole number from 0 up; anything else is the default
  const count = (x: unknown, dflt: number, max: number) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.min(Math.round(x), max) : dflt)
  return {
    version: 1,
    env,
    scripts: Array.isArray(o.scripts) ? o.scripts : null,
    general: {
      shell: str(g.shell), model: str(g.model), effort: (EFFORTS as readonly string[]).includes(effort) ? (effort as Effort) : '',
      ui: str(g.ui), theme: str(g.theme), appName: str(g.appName) || DEFAULT_APP_NAME,
      appTagline: typeof g.appTagline === 'string' ? g.appTagline.trim() : DEFAULT_APP_TAGLINE, // '' = no tagline
      chrome: g.chrome !== false, // on unless turned off
      desktopNotify: g.desktopNotify !== false, // on unless turned off
      bgModel: str(g.bgModel), bgEffort: level(g.bgEffort), teamModel: str(g.teamModel), teamEffort: level(g.teamEffort),
      idleCloseMinutes: count(g.idleCloseMinutes, DEFAULT_IDLE_CLOSE_MINUTES, 7 * 24 * 60),
      teamMemoryKb: count(g.teamMemoryKb, DEFAULT_TEAM_MEMORY_KB, 1024),
      advisorModel: str(g.advisorModel),
      workflows: g.workflows === 'on' || g.workflows === 'off' ? g.workflows : '',
    },
  }
}

// what the features parse: the store over the .env; credentials only ever from the .env
export function effectiveEnv(dotEnv: Record<string, string>, s: Settings): Record<string, string> {
  const out = { ...dotEnv }
  for (const [k, v] of Object.entries(s.env)) if (!isSecretKey(k)) out[k] = v
  return out
}

// the panel sends the whole key list; a .env key it dropped is saved as '' so it does not come back from the .env
export function envForSave(draft: Record<string, string>, dotEnv: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(draft)) if (/^[A-Za-z_]\w*$/.test(k) && !isSecretKey(k)) out[k] = String(v)
  for (const k of Object.keys(dotEnv)) if (!isSecretKey(k) && !(k in out)) out[k] = ''
  return out
}

export type Section = 'watch' | 'dependabot' | 'deploy' | 'dev' | 'other'
export function sectionOf(k: string): Section {
  if (k.startsWith('HIVE_WATCH_')) return 'watch'
  if (k.startsWith('HIVE_DEPENDABOT_')) return 'dependabot'
  if (k.startsWith('HIVE_DEPLOY_') || k === 'HIVE_DIFFS_SCRIPT') return 'deploy'
  if (/^HIVE_(REPOS_ROOT|AGENTS_FOLDERS|PULL_SKIP|WORKTREES_DIR|STACKS|SERVICES|DOCKER_DESKTOP)$|^HIVE_(STACK|SVC)_/.test(k)) return 'dev'
  return 'other'
}

// error = cannot be used, the save is refused; warn = saved, but worth a look (a path that does not exist yet...)
export type Problem = { key: string; level: 'error' | 'warn'; message: string }
// characters a name shown inside "[...]" headers cannot hold (the app name, a watcher's name)
export const BAD_NAME = /[[\]\r\n]/
export const REPO_RE = /^[\w.-]+\/[\w.-]+$/
export const ID_RE = /^[\w-]+$/
export const envKey = (k: string) => k.toUpperCase().replace(/[^A-Z0-9]/g, '_')
const items = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)

export function validateSettings(d: { env: Record<string, string>; scripts: unknown[] | null; general: General }, exists: (p: string) => boolean, home = ''): Problem[] {
  const out: Problem[] = []
  const e = d.env
  const v = (k: string) => (e[k] ?? '').trim()
  const err = (key: string, message: string) => out.push({ key, level: 'error', message })
  const warn = (key: string, message: string) => out.push({ key, level: 'warn', message })
  const root = v('HIVE_REPOS_ROOT')
  const expand = (p: string) => p.replace(/^~(?=$|[\\/])/, home)
  const under = (p: string) => (isAbsolute(expand(p)) || /^[a-zA-Z]:[\\/]/.test(p) ? expand(p) : root ? join(root, p) : p)
  const path = (key: string, what: string) => { const p = v(key); if (p && !exists(under(p))) warn(key, `${what} ${p} does not exist`) }

  // Watch: the HIVE_WATCH_* keys only seed watcher "watch" once (watchers.ts); watchers keep their own settings

  // Dependabot
  for (const r of items(e.HIVE_DEPENDABOT_REPOS)) if (!REPO_RE.test(r)) err('HIVE_DEPENDABOT_REPOS', `${r} is not owner/name`)
  const dt = v('HIVE_DEPENDABOT_TIME')
  if (dt && !parseTime(dt)) err('HIVE_DEPENDABOT_TIME', `${dt} is not HH:MM`)
  if (items(e.HIVE_DEPENDABOT_REPOS).length && !parseDependabotConfig(e).config) err('HIVE_DEPENDABOT_REPOS', 'no usable repo')

  // Dev stack and Pull latest
  if (root && !exists(root)) warn('HIVE_REPOS_ROOT', `Repos root ${root} does not exist`)
  if (root) for (const p of parseDevConfig(e).problems) warn('dev', p)
  for (const k of Object.keys(e)) if (/^HIVE_SVC_\w+_REPO$/.test(k)) path(k, 'Repo folder')
  for (const [k, what] of [['HIVE_STACKS', 'stack'], ['HIVE_SERVICES', 'service'], ['HIVE_DEPLOY_SUITES', 'suite']] as const)
    for (const id of items(e[k])) if (!ID_RE.test(id)) err(k, `${id} is not a ${what} id (letters, digits, - and _)`)
  for (const id of items(e.HIVE_SERVICES)) {
    const kind = v(`HIVE_SVC_${envKey(id)}_KIND`)
    if (kind && kind !== 'docker' && kind !== 'process') err(`HIVE_SVC_${envKey(id)}_KIND`, `${kind} is not docker or process`)
  }
  for (const k of Object.keys(e)) if (/^HIVE_SVC_\w+_PORT$/.test(k) && v(k) && !(Number.isInteger(Number(v(k))) && Number(v(k)) > 0 && Number(v(k)) < 65536)) err(k, `${v(k)} is not a port`)

  // Deploy
  if (items(e.HIVE_DEPLOY_SUITES).length) {
    for (const p of parseDeployConfig(e).problems) warn('deploy', p)
    path('HIVE_DEPLOY_SCRIPT', 'Deploy script')
    path('HIVE_DIFFS_SCRIPT', 'Diffs script')
  }
  if (v('HIVE_DEPLOY_REGION') && !/^[a-z]{2}(-[a-z]+)+-\d+$/.test(v('HIVE_DEPLOY_REGION'))) err('HIVE_DEPLOY_REGION', `${v('HIVE_DEPLOY_REGION')} is not a region like us-east-1`)
  if (v('HIVE_DEPLOY_ORG') && !/^[\w.-]+$/.test(v('HIVE_DEPLOY_ORG'))) err('HIVE_DEPLOY_ORG', `${v('HIVE_DEPLOY_ORG')} is not a GitHub owner`)

  // Scripts
  if (d.scripts) {
    for (const p of parseScriptsConfig(JSON.stringify(d.scripts)).problems) err('scripts', p)
    d.scripts.forEach((s) => {
      const cwd = s && typeof s === 'object' ? String((s as Record<string, unknown>).cwd ?? '').trim() : ''
      if (cwd && /^[a-zA-Z]:[\\/]|^\//.test(cwd) && !exists(cwd)) warn('scripts', `Folder ${cwd} does not exist`)
    })
  }

  // General
  if (d.general.effort && !(EFFORTS as readonly string[]).includes(d.general.effort)) err('general.effort', `${d.general.effort} is not an effort level`)
  for (const k of ['bgEffort', 'teamEffort'] as const) if (d.general[k] && !(EFFORTS as readonly string[]).includes(d.general[k])) err(`general.${k}`, `${d.general[k]} is not an effort level`)
  for (const k of ['idleCloseMinutes', 'teamMemoryKb'] as const) {
    const n = d.general[k]
    if (n !== undefined && !(typeof n === 'number' && Number.isInteger(n) && n >= 0)) err(`general.${k}`, `${n} is not a whole number of ${k === 'idleCloseMinutes' ? 'minutes' : 'KB'}`)
  }
  const cap = v('HIVE_DEPENDABOT_MAX_REVIEWS')
  if (cap && !(Number.isInteger(Number(cap)) && Number(cap) > 0)) err('HIVE_DEPENDABOT_MAX_REVIEWS', `${cap} is not a whole number above 0`)
  if (d.general.appName.length > 40) err('general.appName', 'App name is longer than 40 characters')
  if (!d.general.appName.trim()) err('general.appName', 'App name is empty')
  // the name goes into bracketed one-line headers (watcher runs, wake-ups): brackets or a line break would cut them
  if (BAD_NAME.test(d.general.appName)) err('general.appName', 'App name cannot contain [ ] or a line break')
  if (d.general.appTagline.length > 80) err('general.appTagline', 'Tagline is longer than 80 characters')
  if (d.general.ui && !ID_RE.test(d.general.ui)) err('general.ui', `${d.general.ui} is not a UI id`)
  if (d.general.theme && !ID_RE.test(d.general.theme)) err('general.theme', `${d.general.theme} is not a theme id`)
  for (const k of Object.keys(e)) if (isSecretKey(k)) err(k, `${k} looks like a credential: keep it in the vault or the .env, not in Hive settings`)
  if (d.general.shell && /[\\/]/.test(d.general.shell) && !exists(d.general.shell)) warn('general.shell', `Shell ${d.general.shell} does not exist`)
  return out
}

// ---- for the panel: lists ----

export const splitList = (v: string | undefined) => items(v)
export const joinList = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean).join(',')
