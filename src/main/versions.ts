// The two things every thread runs on, and keeping them current: the installed Claude Code (the same one the terminal
// uses) and the Agent SDK this app talks to it with. Their versions are shown in the status line. A newer Claude Code is
// installed by itself with `claude update`; a newer SDK is installed into the app's folder with npm (a run from source
// only) and is used from the next start.
import { app } from 'electron'
import { exec } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { engineInfo, latestEngine, updateEngine } from './engine'
import { TEST_MODE } from './testMode'

const SDK = '@anthropic-ai/claude-agent-sdk'
const AUTO_SDK: boolean = false
export type Versions = {
  claude: { version: string | null; latest: string | null; state: '' | 'updating' | 'failed' }
  // waiting: the version installed on disk that the running app does not use yet (restart to use it)
  sdk: { version: string | null; latest: string | null; state: '' | 'updating' | 'failed'; waiting: string | null }
  checkedAt: number | null
}

let state: Versions = { claude: { version: null, latest: null, state: '' }, sdk: { version: null, latest: null, state: '', waiting: null }, checkedAt: null }
let notify: (v: Versions) => void = () => {}
let running: string | null = null // the SDK version this process loaded

const nums = (v: string) => v.split('.').map((n) => Number(n) || 0)
/** a is newer than b */
export const newer = (a: string | null, b: string | null): boolean => {
  if (!a || !b) return false
  const x = nums(a), y = nums(b)
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}
const sameLine = (a: string, b: string) => nums(a).slice(0, 2).join('.') === nums(b).slice(0, 2).join('.')

function sdkOnDisk(): string | null {
  try { return String(JSON.parse(readFileSync(join(app.getAppPath(), 'node_modules', ...SDK.split('/'), 'package.json'), 'utf8')).version ?? '') || null } catch { return null }
}
async function latestSdk(): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${SDK}/latest`, { headers: { 'User-Agent': 'Hive' } })
    const v = res.ok ? ((await res.json()) as { version?: string }).version : undefined
    return v && /^\d+\.\d+\.\d+$/.test(v) ? v : null
  } catch { return null }
}
const set = (patch: Partial<Versions>) => { state = { ...state, ...patch }; notify(state) }

let busy = false
/** read both versions, and install what is newer (auto) */
export async function checkVersions(auto = true): Promise<Versions> {
  if (TEST_MODE) return state
  if (busy) return state
  busy = true
  try {
    const [eng, engLatest, sdkLatest] = await Promise.all([engineInfo(), latestEngine(), latestSdk()])
    const disk = sdkOnDisk()
    running ??= disk
    set({
      claude: { ...state.claude, version: eng.version, latest: engLatest },
      sdk: { ...state.sdk, version: running, latest: sdkLatest, waiting: disk && running && disk !== running ? disk : null },
      checkedAt: Date.now(),
    })
    if (!auto) return state
    if (eng.installed && newer(engLatest, eng.version)) {
      set({ claude: { ...state.claude, state: 'updating' } })
      const r = await updateEngine()
      const after = await engineInfo()
      set({ claude: { version: after.version, latest: engLatest, state: r.ok ? '' : 'failed' } })
    }
    // the SDK: only for a run from source (an installed app carries its own copy), and only within the same release
    // line, so a new line that may change how the app must talk to it is never taken unasked
    // Hive Next never installs it by itself: a run from a worktree shares node_modules with the main checkout, so an
    // install here would change the other app's dependencies under it. The status line says when a newer one exists.
    if (AUTO_SDK && !app.isPackaged && disk && sdkLatest && newer(sdkLatest, disk) && sameLine(sdkLatest, disk)) {
      set({ sdk: { ...state.sdk, state: 'updating' } })
      const ok = await new Promise<boolean>((res) => exec(`npm install ${SDK}@${sdkLatest} --no-audit --no-fund`, { cwd: app.getAppPath(), windowsHide: true, timeout: 5 * 60_000 }, (err) => res(!err)))
      const now = sdkOnDisk()
      set({ sdk: { version: running, latest: sdkLatest, state: ok ? '' : 'failed', waiting: now && running && now !== running ? now : null } })
    }
    return state
  } finally { busy = false }
}

export const versions = (): Versions => state

export function startVersions(onChange: (v: Versions) => void): void {
  notify = onChange
  if (TEST_MODE) return
  setTimeout(() => void checkVersions(), 20_000)
  setInterval(() => void checkVersions(), 60 * 60_000)
}
