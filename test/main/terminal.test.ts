// Real pty through terminal.ts: echo comes back, resize reaches the shell, kill leaves no process behind.
// Skipped when node-pty's native module cannot load on this machine.
import { afterAll, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { agentLaunch, killAllTerminals, killTerminal, openTerminal, resizeTerminal, setTerminalSink, terminalPids, trimScrollback, writeTerminal } from '../../src/main/terminal'

const isWin = process.platform === 'win32'
const hasPty = (() => {
  try {
    createRequire(import.meta.url)('node-pty')
    return true
  } catch {
    return false
  }
})()

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const childrenOf = (pid: number): number[] => {
  try {
    const out = isWin
      ? execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${pid}' | ForEach-Object { $_.ProcessId }`], { encoding: 'utf8', windowsHide: true })
      : execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
    return out.split(/\r?\n/).filter(Boolean).map(Number)
  } catch {
    return [] // pgrep exits 1 when there are none
  }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(fn: () => boolean, ms: number, what: string) {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`)
    await wait(50)
  }
}

test('scrollback is bounded and cut at a line start', () => {
  assert.equal(trimScrollback('x'.repeat(10) + '\n' + 'y'.repeat(100), 1000), 'x'.repeat(10) + '\n' + 'y'.repeat(100))
  assert.equal(trimScrollback('aaaa\nbbbb\ncccc', 7), 'cccc')
  assert.ok(trimScrollback('z'.repeat(2_000_000)).length <= 512 * 1024)
})

test('an agent command is found on PATH; on Windows a .cmd shim runs through cmd.exe with quoted args, a .ps1 one through PowerShell', () => {
  const bin = join('C:', 'tools'), npm = join('C:', 'npm')
  const has = (...files: string[]) => (p: string) => files.includes(p)
  const env = { PATH: [bin, npm].join(';'), PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: 'cmd.exe' }
  // the extensionless sh script npm also writes is skipped on Windows; the .cmd beside it runs
  assert.deepEqual(agentLaunch('codex', ['--model', 'o3'], env, true, has(join(npm, 'codex'), join(npm, 'codex.cmd'), join(npm, 'codex.ps1'))),
    { file: 'cmd.exe', args: `/d /s /c ""${join(npm, 'codex.cmd')}" "--model" "o3""` })
  assert.deepEqual(agentLaunch('gemini', ['-y'], env, true, has(join(bin, 'gemini.exe'))), { file: join(bin, 'gemini.exe'), args: ['-y'] })
  const ps = agentLaunch('pi', ['a b'], env, true, has(join(npm, 'pi.ps1')))
  assert.deepEqual((ps.args as string[]).slice(-3), ['-File', join(npm, 'pi.ps1'), 'a b'])
  assert.throws(() => agentLaunch('codex', ['50%'], env, true, has(join(npm, 'codex.cmd'))), /cannot contain/)
  assert.throws(() => agentLaunch('nope', [], env, true, has()), /nope was not found on PATH/)
  assert.deepEqual(agentLaunch('oc', ['run'], { PATH: '/usr/bin:/opt/bin' }, false, has(join('/opt/bin', 'oc'))), { file: join('/opt/bin', 'oc'), args: ['run'] })
})

describe.skipIf(!hasPty)('terminal sessions (real pty)', () => {
  const out = new Map<string, string>()
  const exits: { id: string; code: number; closed: boolean }[] = []
  setTerminalSink({ data: (id, c) => out.set(id, (out.get(id) ?? '') + c), exit: (id, code, closed) => exits.push({ id, code, closed }) })
  // eslint-disable-next-line no-control-regex -- strips terminal escape sequences
  const text = (id: string) => (out.get(id) ?? '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
  const missing = join(homedir(), 'hive-test-does-not-exist')
  afterAll(() => killAllTerminals())

  let pid = 0
  test('opens a shell and echo comes back', async () => {
    const r = openTerminal('t1', process.cwd(), 100, 30)
    assert.equal(r.fresh, true)
    pid = terminalPids()[0]
    assert.ok(alive(pid), 'shell pid is alive')
    writeTerminal('t1', 'echo hi\r')
    await until(() => /(^|\n)\s*hi\s*(\r|\n)/.test(text('t1')), 20_000, 'hi in output')
  })

  test('resize reaches the shell', async () => {
    resizeTerminal('t1', 140, 40)
    writeTerminal('t1', isWin ? '$Host.UI.RawUI.WindowSize.Width\r' : 'tput cols\r')
    await until(() => /\b140\b/.test(text('t1')), 15_000, 'width 140 after resize')
  })

  test('re-attach returns the same process and its scrollback', () => {
    const again = openTerminal('t1', missing, 100, 30)
    assert.equal(again.fresh, false)
    assert.match(again.scrollback, /hi/)
  })

  test('kill takes the shell and its children', async () => {
    writeTerminal('t1', isWin ? 'ping -n 100 127.0.0.1\r' : 'sleep 100\r')
    await until(() => childrenOf(pid).length > 0, 10_000, 'a child of the shell')
    const kids = childrenOf(pid)
    killTerminal('t1')
    await until(() => exits.some((e) => e.id === 't1'), 10_000, 'exit event')
    assert.equal(exits.find((e) => e.id === 't1')!.closed, true)
    await until(() => !alive(pid) && kids.every((k) => !alive(k)), 10_000, 'shell and children gone')
    assert.equal(terminalPids().length, 0)
  })

  test('a missing cwd falls back; killAll leaves nothing', async () => {
    const b = openTerminal('t2', missing, 80, 24)
    assert.notEqual(b.cwd, missing)
    const pid2 = terminalPids()[0]
    killAllTerminals()
    await until(() => !alive(pid2), 10_000, 'shell gone after killAll')
    await until(() => exits.some((e) => e.id === 't2'), 10_000, 't2 exit event')
  })
})
