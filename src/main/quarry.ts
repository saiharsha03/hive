// Quarry, main process: find the installed exe, run one `quarry serve` for as long as it is needed (started on the first
// call, stopped when Orbit quits, started again if it dies), and call it. JSON-RPC 2.0 over the process's stdin and
// stdout, one object per line; requests run concurrently and answers are matched by id (quarryCore.ts). Nothing
// Quarry sends is logged: its stderr is counted, not printed, and a call's params (SQL, values) never are.
// No Electron imports: index.ts serves the UI and routes the Quarry page's calls; a test drives a fake serve.
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkCapabilities, errorOf, installRecord, lineSplitter, pickExe, QuarryError, restartDelay, type Capabilities } from './quarryCore'
import { dataDir, TEST_MODE } from './testMode'

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

// One serve process. command: the exe and its arguments (a test passes node and a fake script)
export class QuarryServe {
  private proc: ChildProcess | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private wanted = false
  private failures = 0
  private upSince = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  stderrBytes = 0
  starts = 0

  // env: added to the process's environment (the e2e run's isolated Quarry, quarryEnv)
  constructor(private command: () => [string, ...string[]], private onState: (up: boolean, why?: string) => void = () => {}, private env: Record<string, string> = {}) {}

  get running(): boolean { return !!this.proc }

  private start(): void {
    if (this.proc || !this.wanted) return
    const [cmd, ...args] = this.command()
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, ...this.env } })
    this.proc = p
    this.starts++
    this.upSince = Date.now()
    p.stdout!.setEncoding('utf8')
    p.stdout!.on('data', lineSplitter((line) => this.answer(line)))
    p.stderr!.on('data', (d: Buffer) => { this.stderrBytes += d.length }) // Quarry's logs: never printed (they can name hosts)
    p.on('error', (e) => this.ended(p, `could not start Quarry: ${e.message}`))
    p.on('exit', (code) => this.ended(p, `Quarry exited (${code ?? 'signal'})`))
    p.stdin!.on('error', () => { /* the process went away; exit handles it */ })
    this.onState(true)
  }

  private answer(line: string): void {
    let m: any
    try { m = JSON.parse(line) } catch { return }
    const p = typeof m?.id === 'number' ? this.pending.get(m.id) : undefined
    if (!p) return
    this.pending.delete(m.id)
    clearTimeout(p.timer)
    if (m.error) p.reject(errorOf(m.error))
    else p.resolve(m.result)
  }

  private ended(p: ChildProcess, why: string): void {
    if (this.proc !== p) return
    this.proc = null
    for (const [, x] of this.pending) { clearTimeout(x.timer); x.reject(new QuarryError(-32000, why, null)) }
    this.pending.clear()
    this.onState(false, why)
    if (!this.wanted) return
    // died on its own: start it again, waiting longer each time it dies soon after starting
    this.failures = Date.now() - this.upSince > 60_000 ? 1 : this.failures + 1
    this.retry = setTimeout(() => { this.retry = null; this.start() }, restartDelay(this.failures))
    this.retry.unref?.()
  }

  // a call, starting the process when it is not running; timeoutMs: give up waiting (the call itself may go on)
  call<T = unknown>(method: string, params?: object, timeoutMs = 90_000): Promise<T> {
    this.wanted = true
    if (this.retry) { clearTimeout(this.retry); this.retry = null }
    this.start()
    const p = this.proc
    if (!p?.stdin?.writable) return Promise.reject(new QuarryError(-32000, 'Quarry is not running', null))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new QuarryError(-32000, `Quarry did not answer ${method} within ${Math.round(timeoutMs / 1000)} s`, null)) }, timeoutMs)
      timer.unref?.()
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      p.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`)
    })
  }

  // closing stdin makes Quarry finish what is in flight, close its database sessions and exit; killed if it does not
  stop(graceMs = 5000): void {
    this.wanted = false
    if (this.retry) { clearTimeout(this.retry); this.retry = null }
    const p = this.proc
    if (!p) return
    try { p.stdin?.end() } catch { /* gone */ }
    const t = setTimeout(() => { try { p.kill() } catch { /* gone */ } }, graceMs)
    t.unref?.()
    p.once('exit', () => clearTimeout(t))
  }
}

// ---- the installed Quarry ----

const appData = () => process.env.APPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Roaming')
// where an installer puts it by default (Tauri's per-user and per-machine installs)
export const DEFAULT_LOCATIONS = (): string[] => [
  join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'Quarry', 'quarry.exe'),
  join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'Programs', 'Quarry', 'quarry.exe'),
  join(process.env.ProgramFiles || 'C:\\Program Files', 'Quarry', 'quarry.exe'),
]
// what Quarry recorded the last time it started: install.json, and on Windows the registry's InstallPath
async function recorded(): Promise<string[]> {
  const out: string[] = []
  try { const r = installRecord(readFileSync(join(appData(), 'Quarry', 'install.json'), 'utf8')); if (r) out.push(r.exe) } catch { /* not recorded */ }
  if (process.platform === 'win32') {
    const reg = await new Promise<string>((res) => execFile('reg', ['query', 'HKCU\\Software\\Quarry', '/v', 'InstallPath'], { timeout: 5000, windowsHide: true }, (_e, o) => res(String(o ?? ''))))
    const m = reg.match(/InstallPath\s+REG_SZ\s+(.+)/)
    if (m) out.push(m[1].trim())
  }
  return out
}

const capsOf = (exe: string) => new Promise<string>((res, rej) => execFile(exe, ['--capabilities'], { timeout: 15_000, windowsHide: true, env: { ...process.env, ...quarryEnv() } }, (e, o) => (e ? rej(e) : res(String(o)))))

// Test mode never uses Quarry (it would reach the user's real databases), with one narrow exception: an e2e run that
// sets HIVE_E2E_QUARRY=1 and names the exe in HIVE_QUARRY_EXE (e2e/08-quarry-live.spec.ts). That run's Quarry is
// isolated in the run's own data folder with Quarry's own test switches: its data (QUARRY_HOME), no registry entry, an
// in-memory keyring, and an empty folder in place of the older app it can import from. Nothing else about test mode changes.
export const e2eQuarry = (): string | null => (TEST_MODE && process.env.HIVE_E2E_QUARRY === '1' && process.env.HIVE_QUARRY_EXE ? process.env.HIVE_QUARRY_EXE : null)
export function quarryEnv(): Record<string, string> {
  if (!e2eQuarry()) return {}
  const home = join(dataDir(), 'quarry-home')
  const legacy = join(dataDir(), 'quarry-legacy-none')
  for (const d of [home, legacy]) mkdirSync(d, { recursive: true })
  return { QUARRY_HOME: home, QUARRY_NO_REGISTRY: '1', QUARRY_TEST_KEYRING: 'memory', QUARRY_LEGACY_DIR: legacy }
}

export type QuarryStatus = { available: boolean; exe: string | null; version: string | null; running: boolean; reason: string }
let status: QuarryStatus = { available: false, exe: null, version: null, running: false, reason: 'not checked yet' }
let caps: Capabilities | null = null
let serve: QuarryServe | null = null
let onChange: (s: QuarryStatus) => void = () => {}
export const onQuarryChange = (f: (s: QuarryStatus) => void) => { onChange = f }
const set = (s: Partial<QuarryStatus>) => { status = { ...status, ...s }; onChange(status) }

// Settings > General quarryPath: '' = find the installed Quarry, 'off' = no Quarry, a path = that exe. The feature
// (page, rail link, thread tools) exists only when an exe is found that speaks protocol 1 with the methods Orbit uses.
// how: tests run a fake serve through node instead of an exe
type How = { caps?: (exe: string) => Promise<string>; command?: (exe: string) => [string, ...string[]]; exists?: (p: string) => boolean; recorded?: () => Promise<string[]> }
export async function configureQuarry(setting: string, test = TEST_MODE, how: How = {}): Promise<QuarryStatus> {
  const e2e = test ? e2eQuarry() : null
  const exe = e2e ?? (test ? null : pickExe(setting, await (how.recorded ?? recorded)(), DEFAULT_LOCATIONS(), how.exists ?? existsSync))
  if (exe !== status.exe) { serve?.stop(); serve = null }
  if (!exe) { caps = null; set({ available: false, exe: null, version: null, running: false, reason: setting.trim().toLowerCase() === 'off' ? 'turned off' : 'Quarry is not installed' }); return status }
  let c
  try { c = checkCapabilities(await (how.caps ?? capsOf)(exe)) } catch (e) { c = { ok: false as const, reason: `${exe} did not start: ${(e as Error).message}` } }
  if (!c.ok) { caps = null; set({ available: false, exe, version: null, running: false, reason: c.reason }); return status }
  caps = c.caps
  if (!serve) serve = new QuarryServe(() => (how.command ? how.command(exe) : [exe, 'serve']), (up, why) => set({ running: up, ...(why ? { reason: why } : {}) }), quarryEnv())
  set({ available: true, exe, version: c.caps.version, reason: '' })
  return status
}

export const quarryStatus = (): QuarryStatus => status
export const quarryLimits = () => caps?.agent ?? {}
// a call to the serve process (started on first use); refused when there is no usable Quarry
export function quarryCall<T = unknown>(method: string, params?: object, timeoutMs?: number): Promise<T> {
  if (!serve || !status.available) return Promise.reject(new QuarryError(-32000, `Quarry is not available: ${status.reason}`, null))
  return serve.call<T>(method, params, timeoutMs)
}
export function stopQuarry(): void { serve?.stop() }
