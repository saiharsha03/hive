// Launches the built Hive (out/main/index.js) under Playwright with test mode on: no outside effects, every state
// file in a temp folder, and a throwaway git repo as the workspace root. One temp folder per `npm run e2e`.
//
// What a run still uses of yours: the Claude login. The session specs send real turns, so they count against your
// usage; every thread (background ones too) is therefore started on Haiku at low effort, through the run's own
// settings file. Claude Code writes those sessions' transcripts under its own projects folder; global-teardown.ts
// deletes them, and the run folder, when the run ends.
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
    // a page for the preview, and a Python file for the editor and its language server (one deliberate type error)
    writeFileSync(join(DEMO, 'readme.md'), '# Demo\n\nA **markdown** page.\n')
    writeFileSync(join(DEMO, 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="teal"/></svg>\n')
    writeFileSync(join(DEMO, 'app.py'), 'def greet(name: str) -> str:\n    return "hi " + name\n\n\ncount: int = "three"\n')
  }
  // the workspace .env: only the repos root (no Watch, Dependabot, deploy or stack keys)
  writeFileSync(join(RUN, 'workspace.env'), `HIVE_REPOS_ROOT=${REPOS}\n`)
  // one script whose command would leave a marker file if it ever really ran
  writeFileSync(join(RUN, 'scripts.json'), JSON.stringify([
    { name: 'Weekly report', cwd: SCRIPT_CWD, options: [{ label: 'Full run', cmd: 'echo ran > marker.txt' }] },
  ], null, 2))
  // Nothing of the real Hive is copied in: its session cache and search index hold real conversation text, and no
  // spec needs them (the thread list is built from the transcripts either way, only a little slower the first time).
}

// The settings every launch starts from, written before the app first runs (it would otherwise seed its own with the
// account's default model): Haiku at low effort for every thread, the background ones started by a tool included; no
// Claude in Chrome and no desktop toasts. env stays empty so the launch's .env is what counts, scripts null so the
// run's scripts.json is.
export const TEST_GENERAL = { shell: '', model: 'haiku', effort: 'low', ui: '', theme: '', appName: 'Hive', appTagline: 'One desk, many agents', chrome: false, desktopNotify: false }
// Test mode lists sessions only from HIVE_PROJECTS_DIR (never the real ~/.claude/projects), so the run seeds a few
// small invented transcripts there for the thread list specs (pin, snooze, close, archive). Seeded once per run.
export const PROJECTS = join(RUN, 'projects')
const SEEDED = ['Tidy the demo readme', 'Rename the greet helper', 'Count words in tracked.txt', 'Explain the second file', 'Draft release notes for demo']
// their folder is a made-up path outside the temp folder: the list hides sessions whose folder is under Temp
const SEEDED_CWD = resolve('/e2e-seeded/demo')
export function seedProjects(): void {
  const folder = join(PROJECTS, SEEDED_CWD.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(folder, { recursive: true })
  SEEDED.forEach((title, i) => {
    const file = join(folder, `00000000-0000-4000-8000-00000000000${i}.jsonl`)
    if (existsSync(file)) return
    const at = (m: number) => new Date(Date.now() - (i * 60 + m) * 60_000).toISOString()
    const user = { type: 'user', cwd: SEEDED_CWD, entrypoint: 'cli', sessionId: `seed-${i}`, timestamp: at(2), message: { role: 'user', content: title } }
    const reply = { type: 'assistant', cwd: SEEDED_CWD, sessionId: `seed-${i}`, timestamp: at(1), message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } }
    writeFileSync(file, `${JSON.stringify(user)}
${JSON.stringify(reply)}
`)
  })
}

export function seedSettings(data: string): void {
  const file = join(data, 'hive-settings.json')
  if (!existsSync(file)) writeFileSync(file, JSON.stringify({ version: 1, env: {}, scripts: null, general: TEST_GENERAL }, null, 2) + '\n')
}

// The deploy spec is opt-in: it runs your real diffs.sh, which fetches in the real repos and copies its message to
// the real clipboard. It needs HIVE_E2E_DEPLOY_ENV to name a .env with the repos root and the HIVE_DEPLOY_* keys;
// Hive's own .env is never picked up by itself. Only those keys are copied. null = not asked for (the spec skips).
export function deployEnvFile(): string | null {
  const src = process.env.HIVE_E2E_DEPLOY_ENV
  if (!src || !existsSync(src)) return null
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
  seedSettings(data)
  seedProjects()
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  Object.assign(env, {
    HIVE_TEST_MODE: '1',
    HIVE_DATA_DIR: data,
    HIVE_ENV_FILE: opts.envFile ?? join(RUN, 'workspace.env'),
    HIVE_SCRIPTS_FILE: join(RUN, 'scripts.json'),
    HIVE_PROJECTS_DIR: PROJECTS,
  })
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const executablePath = require(join(ROOT, 'node_modules', 'electron')) as unknown as string
  const app = await electron.launch({ executablePath, args: [ROOT], cwd: ROOT, env, timeout: 60_000 })
  // an exit the test did not ask for (seen once, right after a Claude turn) is logged with its code, for the morning
  const proc = app.process()
  proc.on('exit', (code, signal) => { if (!quitting.has(app)) console.warn(`Hive exited unexpectedly: code ${code} signal ${signal}`) })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // the app is up once its title bar renders
  await page.getByTestId('brand').waitFor({ timeout: 30_000 })
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
