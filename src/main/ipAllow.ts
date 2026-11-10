// IP allowlist: a configured command (HIVE_ALLOWLIST_CMD) that allows this machine's public IP somewhere, such as a
// cloud security group. Hive reads the public IP every couple of minutes; the button is on when the IP is not one the
// command has already succeeded for (allowKnown.ts: home and office both stay known). An IP that can't be read is shown
// as such, not as a change. Test mode reads no IP and never runs the command.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileSafe } from './safeWrite'
import { runFailed, type AllowRun, type AllowStatus } from '../shared/allowCore'
import { blocked, dataDir, TEST_MODE } from './testMode'
import { addKnown, allowState, forgetKnown, readKnown, trustMsOf, type Known } from './allowKnown'

const IP_URL = 'https://checkip.amazonaws.com/'
const CHECK_EVERY = 2 * 60_000

let cmd = ''
let trustMs: number | null = null
let ip: string | null = null
let error = ''
let running = false
let timer: ReturnType<typeof setInterval> | null = null
let notify: (s: AllowStatus) => void = () => {}

const file = () => join(dataDir(), 'hive-allowlist.json')
// every address the command succeeded for (the old single-address file reads as one; the next write converts it)
function saved(): Known[] {
  try { return readKnown(readFileSync(file(), 'utf8')) } catch { return [] }
}
const save = (known: Known[]) => writeFileSafe(file(), JSON.stringify({ known }))

export function allowStatus(): AllowStatus {
  const known = saved()
  const now = Date.now()
  const st = allowState(ip, known, now, trustMs)
  return {
    configured: !!cmd, ip, lastIp: known[0]?.ip ?? null, at: known[0]?.at ?? null, changed: st.changed, running, error,
    known: known.map((k) => ({ ...k, trusted: trustMs === null || now - Date.parse(k.at) < trustMs })), unreadable: st.unreadable,
  }
}

// forget an allowed address (its rule was removed on the other side): the next time Hive is there, it can allow it again
// The address this computer has now is already allowed on the other side (someone added it by hand): keep it as known,
// without running the command.
export function markAllowed(): AllowStatus {
  if (ip) save(addKnown(saved(), ip, new Date().toISOString()))
  const st = allowStatus()
  notify(st)
  return st
}

export function forgetAllowed(address: string): AllowStatus {
  const known = saved()
  if (known.some((k) => k.ip === address)) save(forgetKnown(known, address))
  const st = allowStatus()
  notify(st)
  return st
}

export async function checkIp(): Promise<string | null> {
  if (TEST_MODE) { error = blocked('the public IP check'); return null }
  try {
    const r = await fetch(IP_URL, { signal: AbortSignal.timeout(10_000) })
    const text = (await r.text()).trim()
    if (!r.ok || !/^[\d.:a-f]+$/i.test(text)) throw new Error(`unexpected answer from ${IP_URL}: ${text.slice(0, 80)}`)
    const before = ip
    ip = text
    error = ''
    if (ip !== before) notify(allowStatus())
  } catch (e) {
    ip = null
    error = `could not read the public IP: ${(e as Error).message}`
    notify(allowStatus())
  }
  return ip
}

export function initAllowlist(env: Record<string, string>, onChange: (s: AllowStatus) => void): void {
  cmd = (env.HIVE_ALLOWLIST_CMD ?? '').trim()
  trustMs = trustMsOf(env)
  notify = onChange
  if (!cmd) { if (timer) clearInterval(timer); timer = null; notify(allowStatus()); return }
  if (!timer) { timer = setInterval(() => void checkIp(), CHECK_EVERY); timer.unref() }
  void checkIp()
}

export async function runAllowlist(): Promise<AllowRun> {
  if (!cmd) return { ok: false, ip, output: 'No allowlist command set (Settings > General > IP allowlist command).' }
  if (TEST_MODE) return { ok: true, ip: null, output: blocked('the allowlist command') }
  if (running) return { ok: false, ip, output: 'The allowlist command is already running.' }
  running = true
  notify(allowStatus())
  try {
    const now = await checkIp()
    const { code, output } = await new Promise<{ code: number | null; output: string }>((res) => {
      let out = ''
      const c = spawn(cmd, { shell: true, windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: '1' } })
      c.stdout.on('data', (d) => (out += d))
      c.stderr.on('data', (d) => (out += d))
      c.on('error', (e) => res({ code: -1, output: out + String(e) }))
      c.on('close', (code) => res({ code, output: out }))
    })
    const ok = !runFailed(code, output)
    if (ok && now) save(addKnown(saved(), now, new Date().toISOString()))
    return { ok, ip: now, output: output.trim() || `exited with code ${code}` }
  } finally {
    running = false
    notify(allowStatus())
  }
}
