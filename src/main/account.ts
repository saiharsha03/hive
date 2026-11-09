// Switch the Claude account: the engine's own browser sign-in (`claude auth login`), the same login the terminal uses.
// The app restarts after a successful sign-in, so every thread and the status process run on the new account.
import { spawn, type ChildProcess } from 'node:child_process'
import { claudeExecutable } from './engine'
import { blocked, TEST_MODE } from './testMode'

export type SwitchResult = { ok: boolean; output: string }

let child: ChildProcess | null = null

// email pre-fills the sign-in page; onOutput gets the engine's lines (the sign-in link, if the browser did not open)
export function switchAccount(email: string, onOutput: (text: string) => void): Promise<SwitchResult> {
  if (TEST_MODE) return Promise.resolve({ ok: false, output: blocked('switching the Claude account') })
  if (child) return Promise.resolve({ ok: false, output: 'A sign-in is already open.' })
  const exe = claudeExecutable()
  if (!exe) return Promise.resolve({ ok: false, output: 'Claude Code is not installed, so there is no login to switch.' })
  const args = ['auth', 'login', ...(email.trim() ? ['--email', email.trim()] : [])]
  return new Promise((resolve) => {
    let out = ''
    const c = spawn(exe, args, { windowsHide: true })
    child = c
    const take = (d: Buffer) => { const t = d.toString(); out += t; onOutput(t) }
    c.stdout?.on('data', take)
    c.stderr?.on('data', take)
    c.on('error', (e) => { child = null; resolve({ ok: false, output: `${out}${e.message}` }) })
    c.on('close', (code) => { child = null; resolve({ ok: code === 0, output: out.trim() || `exited with code ${code}` }) })
  })
}

export function cancelSwitch(): void {
  child?.kill()
  child = null
}
