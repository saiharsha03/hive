// Which Claude Code engine Orbit runs: the user's installed `claude` (same version as their terminal,
// updated whenever Claude Code updates itself), else the copy bundled with the Agent SDK.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

const NAMES = process.platform === 'win32' ? ['claude.exe'] : ['claude']

let found: string | null | undefined

export function claudeExecutable(): string | undefined {
  if (found === undefined) {
    const dirs = [join(homedir(), '.local', 'bin'), ...(process.env.PATH ?? '').split(delimiter)]
    found = null
    for (const dir of dirs) for (const name of NAMES) {
      const p = join(dir, name)
      if (!found && dir && existsSync(p)) found = p
    }
  }
  return found ?? undefined // undefined -> the SDK's bundled copy
}

// "2.1.314" from `claude --version`, asked once
let version: Promise<string | null> | undefined
export function engineInfo(): Promise<{ installed: boolean; version: string | null }> {
  const exe = claudeExecutable()
  version ??= exe
    ? new Promise((resolve) => execFile(exe, ['--version'], { timeout: 15000 }, (err, out) => resolve(err ? null : (out.match(/\d+\.\d+\.\d+/)?.[0] ?? null))))
    : Promise.resolve(null)
  return version.then((v) => ({ installed: !!exe, version: v }))
}

// the newest Claude Code on npm, asked at most once an hour (new models ship in new engine versions)
let latest: { at: number; version: string | null } | null = null
export async function latestEngine(): Promise<string | null> {
  if (latest && Date.now() - latest.at < 60 * 60_000) return latest.version
  try {
    const res = await fetch('https://registry.npmjs.org/@anthropic-ai/claude-code/latest', { headers: { 'User-Agent': 'Orbit' } })
    const v = res.ok ? ((await res.json()) as { version?: string }).version : undefined
    latest = { at: Date.now(), version: v && /^\d+\.\d+\.\d+$/.test(v) ? v : null }
  } catch {
    latest = { at: Date.now(), version: null }
  }
  return latest.version
}

// `claude update`, the same updater the terminal uses; new threads start on the new version
export function updateEngine(): Promise<{ ok: boolean; output: string }> {
  const exe = claudeExecutable()
  if (!exe) return Promise.resolve({ ok: false, output: 'No installed claude found; Orbit runs the copy bundled with the SDK.' })
  return new Promise((resolve) => execFile(exe, ['update'], { timeout: 5 * 60_000 }, (err, out, errOut) => {
    version = undefined // ask `claude --version` again
    resolve({ ok: !err, output: `${out}${errOut}`.trim() })
  }))
}
