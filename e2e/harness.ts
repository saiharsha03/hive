// Launches the built Hive (out/main/index.js) under Playwright with test mode on: no outside effects, every state
// file in a temp folder, and a throwaway git repo as the workspace root. One temp folder per `npm run e2e`.
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const ROOT = resolve(__dirname, '..')
// the run folder, made once by global-setup.ts and passed on to every worker
export const RUN = process.env.HIVE_E2E_RUN || join(tmpdir(), 'hive-e2e-adhoc')
export const DATA = join(RUN, 'data')
export const REPOS = join(RUN, 'repos')
export const DEMO = join(REPOS, 'demo')
export const SCRIPT_CWD = join(RUN, 'script-cwd')
export const SHOTS = process.env.HIVE_E2E_SHOTS || join(RUN, 'shots')
// a unique word per run, so this run's threads are easy to find among the real sessions
export const TAG = process.env.HIVE_E2E_TAG || `e2e${Date.now().toString(36)}`

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
export const gitOut = git

// the throwaway workspace: one repo with a commit, a modified file, a new file and a second commit-free change
export function makeWorkspace(): void {
  mkdirSync(DEMO, { recursive: true })
  mkdirSync(SCRIPT_CWD, { recursive: true })
  mkdirSync(DATA, { recursive: true })
  mkdirSync(SHOTS, { recursive: true })
  if (!existsSync(join(DEMO, '.git'))) {
    git(DEMO, 'init', '-q', '-b', 'main')
    git(DEMO, 'config', 'user.email', 'e2e@example.invalid')
    git(DEMO, 'config', 'user.name', 'Hive e2e')
    git(DEMO, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(DEMO, 'tracked.txt'), 'one\ntwo\nthree\n')
    writeFileSync(join(DEMO, 'second.txt'), 'alpha\n')
    git(DEMO, 'add', '.')
    git(DEMO, 'commit', '-q', '-m', 'first commit')
    writeFileSync(join(DEMO, 'tracked.txt'), 'one\nTWO\nthree\nfour\n')
    writeFileSync(join(DEMO, 'second.txt'), 'alpha\nbeta\n')
    writeFileSync(join(DEMO, 'untracked.txt'), 'new file\n')
  }
  // the workspace .env: only the repos root (no Watch, Dependabot, deploy or stack keys)
  writeFileSync(join(RUN, 'workspace.env'), `HIVE_REPOS_ROOT=${REPOS}\n`)
  // one script whose command would leave a marker file if it ever really ran
  writeFileSync(join(RUN, 'scripts.json'), JSON.stringify([
    { name: 'Weekly report', cwd: SCRIPT_CWD, options: [{ label: 'Full run', cmd: 'echo ran > marker.txt' }] },
  ], null, 2))
  // seed Electron's caches from the real Hive (read-only copy) so the session list and search start warm
  const real = join(process.env.APPDATA ?? '', 'hive')
  const ud = join(DATA, 'userData')
  if (!existsSync(ud)) {
    mkdirSync(ud, { recursive: true })
    for (const n of ['sessions-cache.json', 'search', 'models']) {
      if (existsSync(join(real, n))) cpSync(join(real, n), join(ud, n), { recursive: true })
    }
  }
}

// The deploy launch needs the real repos root and the HIVE_DEPLOY_* keys (diffs.sh only fetches); nothing else is
// copied. Source: HIVE_E2E_DEPLOY_ENV, else Hive's own .env. null when neither exists.
export function deployEnvFile(): string | null {
  const src = process.env.HIVE_E2E_DEPLOY_ENV || join(ROOT, '.env')
  if (!existsSync(src)) return null
  const keep = readFileSync(src, 'utf8').split(/\r?\n/).filter((l) => /^(HIVE_REPOS_ROOT|HIVE_DEPLOY_[A-Z0-9_]+|HIVE_DIFFS_SCRIPT)=/.test(l))
  if (!keep.some((l) => l.startsWith('HIVE_DEPLOY_SUITES='))) return null
  const out = join(RUN, 'deploy.env')
  writeFileSync(out, keep.join('\n') + '\n')
  return out
}

export type Launched = { app: ElectronApplication; page: Page }
const quitting = new WeakSet<ElectronApplication>()

// data: the state folder (default DATA); a launch with another .env needs its own, since settings seed once from the first
export async function launch(opts: { envFile?: string; data?: string } = {}): Promise<Launched> {
  const data = opts.data ?? DATA
  mkdirSync(data, { recursive: true })
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  Object.assign(env, {
    HIVE_TEST_MODE: '1',
    HIVE_DATA_DIR: data,
    HIVE_ENV_FILE: opts.envFile ?? join(RUN, 'workspace.env'),
    HIVE_SCRIPTS_FILE: join(RUN, 'scripts.json'),
  })
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const executablePath = require(join(ROOT, 'node_modules', 'electron')) as unknown as string
  const app = await electron.launch({ executablePath, args: [ROOT], cwd: ROOT, env, timeout: 60_000 })
  // an exit the test did not ask for (seen once, right after a Claude turn) is logged with its code, for the morning
  const proc = app.process()
  proc.on('exit', (code, signal) => { if (!quitting.has(app)) console.warn(`Hive exited unexpectedly: code ${code} signal ${signal}`) })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByTestId('top-new').waitFor({ timeout: 30_000 })
  return { app, page }
}

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(SHOTS, `${name}.png`) }).catch(() => {})
}

// Quit the app; if Electron has not exited after 20 s (seen once: a quit right after launch hung for minutes), kill
// the process tree. Hive's state files are written synchronously, so nothing is lost either way.
export async function close(l: Launched | undefined): Promise<void> {
  if (!l) return
  quitting.add(l.app)
  const proc = l.app.process()
  const done = l.app.close().then(() => true, () => true)
  const ok = await Promise.race([done, new Promise<boolean>((r) => setTimeout(() => r(false), 20_000))])
  if (!ok && proc.pid) {
    console.warn('Hive did not quit within 20 s; killing it')
    try { execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'pipe' }) } catch { proc.kill() }
  }
}
