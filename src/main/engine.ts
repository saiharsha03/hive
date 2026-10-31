// Which Claude Code engine Hive runs: the user's installed `claude` (same version as their terminal,
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
