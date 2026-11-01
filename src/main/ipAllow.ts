// IP allowlist: a configured command (HIVE_ALLOWLIST_CMD) that allows this machine's public IP somewhere, such as a
// cloud security group. Hive reads the public IP every couple of minutes; the button is on when it differs from the IP
// the command last succeeded for (or when the IP can't be read). Test mode reads no IP and never runs the command.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileSafe } from './safeWrite'
import { runFailed, type AllowRun, type AllowStatus } from '../shared/allowCore'
import { blocked, dataDir, TEST_MODE } from './testMode'

const IP_URL = 'https://checkip.amazonaws.com/'
const CHECK_EVERY = 2 * 60_000

let cmd = ''
let ip: string | null = null
let error = ''
let running = false
let timer: ReturnType<typeof setInterval> | null = null
let notify: (s: AllowStatus) => void = () => {}

const file = () => join(dataDir(), 'hive-allowlist.json')
function saved(): { ip: string | null; at: string | null } {
  try { const j = JSON.parse(readFileSync(file(), 'utf8')); return { ip: j.ip ?? null, at: j.at ?? null } } catch { return { ip: null, at: null } }
}

export function allowStatus(): AllowStatus {
  const s = saved()
  return { configured: !!cmd, ip, lastIp: s.ip, at: s.at, changed: !ip || ip !== s.ip, running, error }
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
    if (ok && now) writeFileSafe(file(), JSON.stringify({ ip: now, at: new Date().toISOString() }))
    return { ok, ip: now, output: output.trim() || `exited with code ${code}` }
  } finally {
    running = false
    notify(allowStatus())
  }
}
